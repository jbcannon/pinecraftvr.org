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
  half_sep <- bimodal * 2 * sd_dbh
  qmd_low  <- max(0.5, qmd - half_sep)
  qmd_high <- qmd + half_sep
  n1       <- round(n / 2)
  combined <- c(.draw_dbh(n1, qmd_low, sd_dbh), .draw_dbh(n - n1, qmd_high, sd_dbh))
  sample(combined)
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

  .write_output(result$df, output_file, suffix = "_grid")
  invisible(result)
}


# ── Plots ───────────────────────────────────────────────────────────────────

# Stem map: dots positioned like the real stand, sized by DBH, colored by
# defect status. Matches the web tool's preview: green = healthy, black =
# fire scar, amber = another defect (asymmetric crown/leaning/chlorosis/
# canker), and snags are plotted as solid black regardless of size.
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

  ggplot2::ggplot(df, ggplot2::aes(x = X, y = Y, size = DBH, color = Status)) +
    ggplot2::geom_point(alpha = 0.85) +
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
