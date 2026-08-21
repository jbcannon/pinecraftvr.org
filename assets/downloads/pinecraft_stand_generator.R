# pinecraft_stand_generator.R
#
# R template for generating synthetic longleaf pine stands for Pinecraft.
# Mirrors the web-based Stand Generator at pinecraftvr.org/customize.html
# (same DBH/height/defect math, same CSV format), plus adds ggplot2 stem
# map and diameter distribution plots.
#
# Requires: ggplot2 (install.packages("ggplot2") if you don't have it)
#
# Two generator functions, sharing the same arguments:
#
#   generate_stem_map()       - random (complete spatial randomness)
#   generate_stem_map_grid()  - regular planted grid, with a small amount
#                                of jitter so it doesn't look artificially
#                                perfect
#
# Shared arguments:
#   width, height - Plot dimensions, meters
#   density       - Stand density, trees per hectare
#   qmd           - Quadratic mean diameter, cm (center of the DBH distribution)
#   ba            - Basal area, m^2/ha
#                 - density, qmd, and ba are mathematically linked
#                   (ba = density * qmd^2 * pi / 40000), since qmd is defined
#                   as the diameter of the tree of average basal area.
#                   Provide any two; the third is calculated automatically.
#   sd_dbh        - Standard deviation of DBH, cm (spread of the distribution)
#   bimodal       - 0 (unimodal, default) to 1 (bimodal). Splits the stand
#                   into two equal-sized cohorts whose QMDs pull apart
#                   symmetrically from qmd as this increases (e.g. an
#                   overstory + a younger age class), scattered randomly
#                   across the plot rather than clustered. Actual spread
#                   (SD) in the generated stand runs higher than sd_dbh as
#                   a result.
#   p_lopsided, p_leaning, p_chlorosis, p_firescar, p_canker, p_snag
#                 - Per-tree defect probabilities, 0-1. A snag is recorded
#                   as dead with every other defect forced off. A snag
#                   isn't also lopsided or fire-scarred, it's just dead.
#   grass_density - Grass-stage regeneration density, trees per hectare
#                   (default 0 = off). Visual-only seedlings, not part of
#                   the measurable stand (excluded from density/QMD/BA).
#                   Scattered in clumps of 1-20 with ~1-2m spacing between
#                   seedlings, with clumps seeded preferentially into
#                   low-basal-area cells of a coarse 20m grid laid over
#                   the plot — lower local BA means less shade, so more
#                   weight — rather than spread evenly across it.
#   seed          - Optional integer for reproducibible output
#   output_file   - Optional output path; auto-named CustomMap_YYYYMMDD*.csv
#
# Note on reproducibility: R and JavaScript use different random number
# generators, so the same seed will NOT produce an identical stand between
# this script and the website's Stand Generator. Reproducibility only
# holds within each tool.


# ── Shared helpers ─────────────────────────────────────────────────────────────

# Density, QMD, and Basal Area are mathematically linked (ba = density *
# qmd^2 * pi / 40000), since QMD is defined as the diameter of the tree of
# average basal area. Provide any two; this fills in the third. If all
# three are given, density and qmd are used as authoritative, and a warning
# is issued if the supplied ba doesn't match what they imply.
.solve_density_qmd_ba <- function(density, qmd, ba) {
  provided <- c(density = !is.null(density), qmd = !is.null(qmd), ba = !is.null(ba))
  if (sum(provided) < 2) {
    stop("Provide at least two of: density, qmd, ba.")
  }
  if (is.null(density)) {
    density <- ba * 40000 / (pi * qmd^2)
  } else if (is.null(qmd)) {
    qmd <- sqrt(ba * 40000 / (pi * density))
  } else {
    expected_ba <- density * qmd^2 * pi / 40000
    if (!is.null(ba) && abs(expected_ba - ba) / expected_ba > 0.01) {
      warning(sprintf(
        "Supplied ba (%.2f) doesn't match density and qmd (%.2f implied); using density and qmd, ba argument ignored.",
        ba, expected_ba))
    }
    ba <- expected_ba
  }
  list(density = density, qmd = qmd, ba = ba)
}

# Basal area (m^2/ha): sum of every tree's cross-sectional area at breast
# height, per hectare. Includes snags (not just live trees), consistent
# with density and qmd, which are also computed over every tree.
.basal_area_per_ha <- function(dbh_cm, area_ha) {
  sum((pi / 4) * (dbh_cm / 100)^2) / area_ha
}

# Generate DBH values (log-normal) targeting a given QMD and SD.
# Log-normal is strictly positive so zero DBH is impossible.
# Parameterisation:
#   QMD  = exp(mu + sigma²)          [quadratic mean diameter]
#   SD²  = QMD² * (exp(sigma²) - 1)  [variance of a log-normal]
#   → sigma² = log(1 + (sd_dbh / qmd)²)
#   → mu     = log(qmd) - sigma²
.draw_dbh <- function(n, qmd, sd_dbh) {
  sigma2 <- log(1 + (sd_dbh / qmd)^2)
  mu     <- log(qmd) - sigma2
  dbh    <- rlnorm(n, meanlog = mu, sdlog = sqrt(sigma2))
  pmax(0.1, round(dbh, 2))   # hard floor at 0.1 cm; log-normal can't hit 0
                               # but this guards against extreme rounding
}

# Bimodal splits the stand into two equal-sized cohorts with QMDs pulled
# symmetrically apart from the target QMD, each still drawn with the same
# SD. At bimodal<=0 both cohorts collapse back to a single .draw_dbh() call.
# Cohort assignment is shuffled (not tied to generation order) so the two
# size classes end up scattered across the plot rather than clustered —
# this matters most for the grid pattern, where leaving the first half of
# trees in cohort 1 would visibly segregate them by row.
.draw_dbh_mixture <- function(n, qmd, sd_dbh, bimodal) {
  if (is.null(bimodal) || bimodal <= 0) {
    return(.draw_dbh(n, qmd, sd_dbh))
  }
  # Split QMD^2 (not QMD itself) symmetrically between the two cohorts, so
  # their combined quadratic mean stays locked to the target QMD no matter
  # how far apart bimodal pulls them. Splitting QMD directly (the obvious
  # approach) systematically inflates the realized QMD/Basal Area, because
  # quadratic mean is convex: separating two values while holding their
  # arithmetic center fixed always raises the quadratic mean above that
  # center — worse the more they're separated (higher bimodal) and the
  # wider each cohort already is (higher sd_dbh).
  t        <- min(0.95, bimodal * 4 * (sd_dbh / qmd))
  qmd_low  <- qmd * sqrt(1 - t)
  qmd_high <- qmd * sqrt(1 + t)
  n1       <- round(n / 2)
  combined <- c(.draw_dbh(n1, qmd_low, sd_dbh), .draw_dbh(n - n1, qmd_high, sd_dbh))
  sample(combined)
}

# Coarse basal-area grid used to bias grass-stage clump placement toward
# canopy openings (mirrors the web tool's Stand Generator exactly). Live
# trees block light in proportion to their basal area, so a cell with less
# live BA gets proportionally more weight when a clump's home cell is
# picked — a simplified stand-in for "regeneration favors gaps" that
# avoids the cost (and the infinite-retry risk in fully-stocked stands) of
# actually detecting gaps. Snags are excluded: a dead bole doesn't cast
# the shade a live crown does, so it shouldn't suppress regeneration
# around it.
.build_gap_weighted_grid <- function(x, y, dbh, alive, width, height,
                                      cell_m = 20, weight_exponent = 2.5) {
  cols   <- max(1, ceiling(width / cell_m))
  rows   <- max(1, ceiling(height / cell_m))
  cell_w <- width / cols
  cell_h <- height / rows

  cell_ba <- numeric(cols * rows)
  for (i in seq_along(x)) {
    if (alive[i] != 1) next
    col <- min(cols - 1, floor(x[i] / cell_w))
    row <- min(rows - 1, floor(y[i] / cell_h))
    idx <- row * cols + col + 1
    cell_ba[idx] <- cell_ba[idx] + (pi / 4) * (dbh[i] / 100)^2
  }

  weights <- (1 / (1 + cell_ba))^weight_exponent
  list(cols = cols, rows = rows, cell_w = cell_w, cell_h = cell_h, weights = weights)
}

# Grass-stage seedlings: clumps of 1-20 (natural regeneration establishes
# in patches, not evenly) with roughly 1-2m spacing within a clump. Each
# clump's home cell is drawn from the gap-weighted grid above, so clumps
# preferentially land where local basal area (and so shading) is lowest;
# every point still gets clamped to the plot as a safety net.
.generate_grass_stage_positions <- function(n, width, height, gap_grid) {
  X <- numeric(0)
  Y <- numeric(0)
  placed <- 0
  ncell  <- gap_grid$cols * gap_grid$rows
  while (placed < n) {
    cluster_size <- min(n - placed, sample.int(20, 1))
    spacing      <- runif(1, 1, 2)   # this clump's target spacing, 1-2m
    disc_r       <- spacing * sqrt(cluster_size / pi)

    cell_idx <- sample.int(ncell, 1, prob = gap_grid$weights)
    col <- (cell_idx - 1) %% gap_grid$cols
    row <- (cell_idx - 1) %/% gap_grid$cols
    cx  <- col * gap_grid$cell_w + runif(1, 0, gap_grid$cell_w)
    cy  <- row * gap_grid$cell_h + runif(1, 0, gap_grid$cell_h)

    angle <- runif(cluster_size, 0, 2 * pi)
    r     <- disc_r * sqrt(runif(cluster_size))   # uniform over the disc's area
    X <- c(X, pmax(0, pmin(width,  cx + cos(angle) * r)))
    Y <- c(Y, pmax(0, pmin(height, cy + sin(angle) * r)))

    placed <- placed + cluster_size
  }
  list(X = X, Y = Y)
}

# Grass-stage rows, formatted to the same CSV schema as .build_df() but
# with placeholder Height/DBH and no defects — visual only, not measured.
.grass_stage_df <- function(X, Y) {
  n <- length(X)
  data.frame(
    X                 = sprintf("%.6f", X),
    Y                 = sprintf("%.6f", Y),
    Class             = "Grass Stage",
    "Scientific Name" = "Pinus palustris",
    "Common Name"     = "Longleaf Pine",
    Alive             = "true",
    Height            = sprintf("%.2f", rep(0.30, n)),
    DBH               = sprintf("%.2f", rep(0.10, n)),
    Lopsided          = rep(0L, n),
    Leaning           = rep(0L, n),
    Chlorosis         = rep(0L, n),
    FireScar          = rep(0L, n),
    Canker            = rep(0L, n),
    Marked            = "false",
    check.names       = FALSE,
    stringsAsFactors  = FALSE
  )
}

# Chapman-Richards H-D model calibrated to longleaf pine data.
.height_from_dbh <- function(dbh, n) {
  h <- 1.37 + 31 * (1 - exp(-0.035 * dbh))^1.2 + rnorm(n, 0, 0.8)
  pmax(1, round(h, 2))
}

# A snag is recorded as dead with every other defect forced off.
.defect_flags <- function(n, p_lopsided, p_leaning, p_chlorosis,
                           p_firescar, p_canker, p_snag) {
  snag <- rbinom(n, 1, p_snag)
  list(
    Alive     = as.integer(!snag),
    Lopsided  = ifelse(snag == 1, 0L, rbinom(n, 1, p_lopsided)),
    Leaning   = ifelse(snag == 1, 0L, rbinom(n, 1, p_leaning)),
    Chlorosis = ifelse(snag == 1, 0L, rbinom(n, 1, p_chlorosis)),
    FireScar  = ifelse(snag == 1, 0L, rbinom(n, 1, p_firescar)),
    Canker    = ifelse(snag == 1, 0L, rbinom(n, 1, p_canker))
  )
}

.build_df <- function(X, Y, DBH, Height, defects) {
  data.frame(
    X                 = sprintf("%.6f", X),
    Y                 = sprintf("%.6f", Y),
    Class             = "Tree",
    "Scientific Name" = "Pinus palustris",
    "Common Name"     = "Longleaf Pine",
    Alive             = ifelse(defects$Alive == 1, "true", "false"),
    Height            = sprintf("%.2f", Height),
    DBH               = sprintf("%.2f", DBH),
    Lopsided          = defects$Lopsided,
    Leaning           = defects$Leaning,
    Chlorosis         = defects$Chlorosis,
    FireScar          = defects$FireScar,
    Canker            = defects$Canker,
    Marked            = "false",
    check.names       = FALSE,
    stringsAsFactors  = FALSE
  )
}

.write_output <- function(df, output_file, suffix = "") {
  if (is.null(output_file)) {
    date_str    <- format(Sys.Date(), "%Y%m%d")
    output_file <- paste0("CustomMap_", date_str, suffix, ".csv")
    if (file.exists(output_file)) {
      output_file <- paste0("CustomMap_", date_str, suffix,
                             "_", format(Sys.time(), "%H%M%S"), ".csv")
    }
  }
  write.csv(df, file = output_file, row.names = FALSE, quote = FALSE)
  message(sprintf("Wrote %d trees to:\n  %s", nrow(df), output_file))
  invisible(output_file)
}

# Bundles everything a caller needs: the CSV-ready data.frame, the raw
# vectors for plotting, and the plot dimensions.
.make_result <- function(X, Y, DBH, Height, defects, width, height) {
  list(
    df = .build_df(X, Y, DBH, Height, defects),
    X = X, Y = Y, DBH = DBH, Height = Height, defects = defects,
    width = width, height = height
  )
}


# ── Random stem map (complete spatial randomness) ─────────────────────────────

generate_stem_map <- function(width,
                               height,
                               density       = NULL,
                               qmd           = NULL,
                               ba            = NULL,
                               sd_dbh        = qmd * 0.4,
                               bimodal       = 0,
                               p_lopsided    = 0.032,
                               p_leaning     = 0.038,
                               p_chlorosis   = 0.002,
                               p_firescar    = 0.018,
                               p_canker      = 0.012,
                               p_snag        = 0.04,
                               grass_density = 0,
                               seed          = NULL,
                               output_file   = NULL) {

  solved   <- .solve_density_qmd_ba(density, qmd, ba)
  density  <- solved$density
  qmd      <- solved$qmd
  ba       <- solved$ba

  area_ha <- (width * height) / 10000
  n       <- round(density * area_ha)
  if (n < 1) stop("Density too low: zero trees for this plot size.")

  message(sprintf("Plot: %.2f x %.2f m (%.4f ha) | Trees: %d",
                  width, height, area_ha, n))

  if (!is.null(seed)) set.seed(seed)

  X   <- runif(n, 0, width)
  Y   <- runif(n, 0, height)
  DBH <- .draw_dbh_mixture(n, qmd, sd_dbh, bimodal)

  message(sprintf("QMD: %.1f cm | Actual QMD: %.1f cm | SD: %.1f cm",
                  qmd, sqrt(mean(DBH^2)), sd(DBH)))
  message(sprintf("Basal Area: %.1f m^2/ha | Actual Basal Area: %.1f m^2/ha",
                  ba, .basal_area_per_ha(DBH, area_ha)))

  Height  <- .height_from_dbh(DBH, n)
  defects <- .defect_flags(n, p_lopsided, p_leaning, p_chlorosis,
                           p_firescar, p_canker, p_snag)
  result  <- .make_result(X, Y, DBH, Height, defects, width, height)

  n_grass <- round(grass_density * area_ha)
  grass_x <- numeric(0)
  grass_y <- numeric(0)
  if (n_grass > 0) {
    gap_grid  <- .build_gap_weighted_grid(X, Y, DBH, defects$Alive, width, height)
    grass_pos <- .generate_grass_stage_positions(n_grass, width, height, gap_grid)
    grass_x   <- grass_pos$X
    grass_y   <- grass_pos$Y
    result$df <- rbind(result$df, .grass_stage_df(grass_x, grass_y))
    message(sprintf("Grass Stage: %d seedlings", n_grass))
  }
  result$grass_x <- grass_x
  result$grass_y <- grass_y

  .write_output(result$df, output_file, suffix = "")
  invisible(result)
}


# ── Grid stem map (regular square spacing, with a little jitter) ──────────────

generate_stem_map_grid <- function(width,
                                    height,
                                    density       = NULL,
                                    qmd           = NULL,
                                    ba            = NULL,
                                    sd_dbh        = qmd * 0.4,
                                    bimodal       = 0,
                                    p_lopsided    = 0.032,
                                    p_leaning     = 0.038,
                                    p_chlorosis   = 0.002,
                                    p_firescar    = 0.018,
                                    p_canker      = 0.012,
                                    p_snag        = 0.04,
                                    grass_density = 0,
                                    jitter        = 0.25,
                                    seed          = NULL,
                                    output_file   = NULL) {

  solved   <- .solve_density_qmd_ba(density, qmd, ba)
  density  <- solved$density
  qmd      <- solved$qmd
  ba       <- solved$ba

  # Spacing (m) for a square grid at the target density
  spacing <- sqrt(10000 / density)

  # Build grid centred within the plot so partial margins are equal on both sides
  nx <- floor(width / spacing)
  ny <- floor(height / spacing)
  if (nx < 1 || ny < 1) {
    stop("Density too low for this plot size: spacing between trees would exceed the plot dimensions.")
  }

  x_margin <- (width - (nx - 1) * spacing) / 2
  y_margin <- (height - (ny - 1) * spacing) / 2

  xs <- x_margin + (0:(nx - 1)) * spacing
  ys <- y_margin + (0:(ny - 1)) * spacing

  grid <- expand.grid(X = xs, Y = ys)
  n    <- nrow(grid)

  area_ha        <- width * height / 10000
  actual_density <- n / area_ha

  message(sprintf("Plot:   %.2f x %.2f m (%.4f ha)", width, height, area_ha))
  message(sprintf("Grid:   %d x %d  |  Spacing: %.3f m  |  Trees: %d  (%.1f tph)",
                  nx, ny, spacing, n, actual_density))

  if (!is.null(seed)) set.seed(seed)

  # Real planting isn't laser-precise. A small jitter keeps the grid from
  # looking artificially perfect (matches the web tool's behavior).
  X <- grid$X + runif(n, -jitter, jitter)
  Y <- grid$Y + runif(n, -jitter, jitter)

  DBH <- .draw_dbh_mixture(n, qmd, sd_dbh, bimodal)

  message(sprintf("QMD: %.1f cm | Actual QMD: %.1f cm | SD: %.1f cm",
                  qmd, sqrt(mean(DBH^2)), sd(DBH)))
  message(sprintf("Basal Area: %.1f m^2/ha | Actual Basal Area: %.1f m^2/ha",
                  ba, .basal_area_per_ha(DBH, area_ha)))

  Height  <- .height_from_dbh(DBH, n)
  defects <- .defect_flags(n, p_lopsided, p_leaning, p_chlorosis,
                           p_firescar, p_canker, p_snag)
  result  <- .make_result(X, Y, DBH, Height, defects, width, height)

  n_grass <- round(grass_density * area_ha)
  grass_x <- numeric(0)
  grass_y <- numeric(0)
  if (n_grass > 0) {
    gap_grid  <- .build_gap_weighted_grid(X, Y, DBH, defects$Alive, width, height)
    grass_pos <- .generate_grass_stage_positions(n_grass, width, height, gap_grid)
    grass_x   <- grass_pos$X
    grass_y   <- grass_pos$Y
    result$df <- rbind(result$df, .grass_stage_df(grass_x, grass_y))
    message(sprintf("Grass Stage: %d seedlings", n_grass))
  }
  result$grass_x <- grass_x
  result$grass_y <- grass_y

  .write_output(result$df, output_file, suffix = "_grid")
  invisible(result)
}


# ── Plots ───────────────────────────────────────────────────────────────────

# Stem map: dots positioned like the real stand, sized by DBH, colored by
# defect status. Matches the web tool's preview: green = healthy, black =
# fire scar, amber = another defect (asymmetric crown/leaning/chlorosis/
# canker), snags are plotted as solid black regardless of size, and (if
# grass_density was set) grass-stage seedlings are drawn as small pale
# dots underneath, same as the web tool's preview.
plot_stem_map <- function(result) {
  if (!requireNamespace("ggplot2", quietly = TRUE)) {
    stop('This needs the ggplot2 package: install.packages("ggplot2")')
  }
  d <- result$defects
  other_defect <- as.integer(d$Lopsided | d$Leaning | d$Chlorosis | d$Canker)

  status <- ifelse(d$Alive == 0, "Snag",
             ifelse(d$FireScar == 1, "Fire Scar",
              ifelse(other_defect == 1, "Other Defect", "Healthy")))
  status <- factor(status, levels = c("Healthy", "Fire Scar", "Other Defect", "Snag"))

  df <- data.frame(X = result$X, Y = result$Y, DBH = result$DBH, Status = status)

  gg <- ggplot2::ggplot()

  if (!is.null(result$grass_x) && length(result$grass_x) > 0) {
    grass_df <- data.frame(X = result$grass_x, Y = result$grass_y)
    gg <- gg + ggplot2::geom_point(data = grass_df, ggplot2::aes(x = X, y = Y),
                                    color = "#c4d678", alpha = 0.5, size = 0.8)
  }

  gg +
    ggplot2::geom_point(data = df, ggplot2::aes(x = X, y = Y, size = DBH, color = Status),
                        alpha = 0.85) +
    ggplot2::scale_color_manual(values = c(
      "Healthy"      = "#7fc25c",
      "Fire Scar"    = "#191614",
      "Other Defect" = "#d68529",
      "Snag"         = "#000000"
    )) +
    ggplot2::scale_size_continuous(range = c(1, 6), name = "DBH (cm)") +
    ggplot2::coord_equal(xlim = c(0, result$width), ylim = c(0, result$height)) +
    ggplot2::labs(title = "Stem Map", x = "X (m)", y = "Y (m)", color = "Status") +
    ggplot2::theme_minimal()
}

# Diameter distribution: 2cm bins, matching the web tool's histogram.
plot_diameter_distribution <- function(result) {
  if (!requireNamespace("ggplot2", quietly = TRUE)) {
    stop('This needs the ggplot2 package: install.packages("ggplot2")')
  }
  df <- data.frame(DBH = result$DBH)

  ggplot2::ggplot(df, ggplot2::aes(x = DBH)) +
    ggplot2::geom_histogram(binwidth = 2, boundary = 0,
                            fill = "#5a6f3d", color = "white") +
    ggplot2::labs(title = "Diameter Distribution", x = "DBH (cm)", y = "Number of Trees") +
    ggplot2::theme_minimal()
}


# ── Example calls (uncomment to run) ──────────────────────────────────────────
# result <- generate_stem_map(width = 100, height = 100, density = 150,
#                              qmd = 30, sd_dbh = 6, seed = 42)
# plot_stem_map(result)
# plot_diameter_distribution(result)
#
# result_grid <- generate_stem_map_grid(width = 100, height = 100, density = 150,
#                                        qmd = 30, sd_dbh = 6, seed = 42)
# plot_stem_map(result_grid)
#
# Override defect rates (values are probabilities 0–1):
# generate_stem_map(width = 100, height = 100, density = 150, qmd = 30,
#                    sd_dbh = 6, p_firescar = 0.05, p_snag = 0.10, seed = 42)
#
# Any two of density / qmd / ba determine the third:
# generate_stem_map(width = 100, height = 100, ba = 15, qmd = 30, seed = 42)
#
# Bimodal diameter distribution (e.g. an overstory + a younger age class):
# result_bimodal <- generate_stem_map(width = 100, height = 100, density = 150,
#                                      qmd = 30, sd_dbh = 6, bimodal = 1, seed = 42)
# plot_diameter_distribution(result_bimodal)
#
# Grass-stage regeneration, seeded preferentially into canopy openings:
# result_regen <- generate_stem_map(width = 100, height = 100, density = 150,
#                                    qmd = 30, sd_dbh = 6, grass_density = 250, seed = 42)
# plot_stem_map(result_regen)
