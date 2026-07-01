export const getSuggestions = async (req, res) => {
  try {
    const language = req.query.language || "English";

    if (!req.company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    const suggestions =
      req.company.suggestions?.[language] ||
      req.company.suggestions?.English ||
      [];

    return res.status(200).json({
      success: true,
      suggestions,
    });
  } catch (error) {
    console.error("Suggestion Controller Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load suggestions.",
      error: error.message,
    });
  }
};