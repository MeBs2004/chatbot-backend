export const getCompany = async (req, res) => {
  try {
    if (!req.company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    return res.status(200).json({
      success: true,
      company: req.company,
    });
  } catch (error) {
    console.error("Get Company Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch company.",
      error: error.message,
    });
  }
};