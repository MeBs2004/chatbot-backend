// ======================================================
// DIGITAL MARKETING — fixed services taxonomy. Unlike Energy's fuel
// categories or Education's FAQ categories, these aren't admin-managed
// or company-custom — the spec calls for a curated, fixed list every
// company picks from (a "basic-to-intermediate" MVP, not an
// extensible taxonomy system). Keeping it as a plain constant (not a
// DB collection) avoids building CRUD/seeding machinery nothing asked
// for.
// ======================================================

export const MARKETING_SERVICE_CATEGORIES = [
  {
    key: "seo_search",
    label: "SEO & Search Marketing",
    services: [
      { key: "seo", label: "Search Engine Optimization" },
      { key: "local_seo", label: "Local SEO" },
      { key: "technical_seo", label: "Technical SEO" },
      { key: "onpage_seo", label: "On-page SEO" },
      { key: "offpage_seo", label: "Off-page SEO" },
      { key: "keyword_research", label: "Keyword Research" },
      { key: "link_building", label: "Link Building" },
    ],
  },
  {
    key: "social_media",
    label: "Social Media Marketing",
    services: [
      { key: "instagram_marketing", label: "Instagram Marketing" },
      { key: "facebook_marketing", label: "Facebook Marketing" },
      { key: "linkedin_marketing", label: "LinkedIn Marketing" },
      { key: "youtube_marketing", label: "YouTube Marketing" },
      { key: "tiktok_marketing", label: "TikTok Marketing" },
      { key: "social_media_management", label: "Social Media Management" },
      { key: "influencer_marketing", label: "Influencer Marketing" },
    ],
  },
  {
    key: "paid_advertising",
    label: "Paid Advertising",
    services: [
      { key: "google_ads", label: "Google Ads" },
      { key: "meta_ads", label: "Meta Ads" },
      { key: "facebook_advertising", label: "Facebook Advertising" },
      { key: "instagram_advertising", label: "Instagram Advertising" },
      { key: "linkedin_advertising", label: "LinkedIn Advertising" },
      { key: "ppc_management", label: "PPC Campaign Management" },
      { key: "retargeting", label: "Retargeting" },
    ],
  },
  {
    key: "content_creative",
    label: "Content & Creative Marketing",
    services: [
      { key: "content_marketing", label: "Content Marketing" },
      { key: "blog_writing", label: "Blog Writing" },
      { key: "copywriting", label: "Copywriting" },
      { key: "website_content", label: "Website Content" },
      { key: "video_marketing", label: "Video Marketing" },
      { key: "reels_shortform", label: "Reels & Short-form Videos" },
      { key: "email_marketing", label: "Email Marketing" },
      { key: "branding", label: "Branding" },
    ],
  },
  {
    key: "business_growth",
    label: "Business Growth",
    services: [
      { key: "lead_generation", label: "Lead Generation" },
      { key: "lead_qualification", label: "Lead Qualification" },
      { key: "cro", label: "Conversion Rate Optimization" },
      { key: "marketing_strategy", label: "Marketing Strategy" },
      { key: "marketing_automation", label: "Marketing Automation" },
      { key: "ecommerce_marketing", label: "E-commerce Marketing" },
      { key: "funnel_optimization", label: "Funnel Optimization" },
    ],
  },
];

export const MARKETING_SERVICE_KEYS = MARKETING_SERVICE_CATEGORIES.flatMap((c) => c.services.map((s) => s.key));

export const marketingServiceLabel = (key) => {
  for (const cat of MARKETING_SERVICE_CATEGORIES) {
    const svc = cat.services.find((s) => s.key === key);
    if (svc) return svc.label;
  }
  return key;
};

export const BUSINESS_TYPES = [
  "Digital Marketing Agency",
  "SEO Agency",
  "Social Media Marketing Agency",
  "Performance Marketing Agency",
  "Freelancer",
  "Marketing Consultant",
  "In-house Marketing Team",
  "Other",
];

// Each capability maps to a short description the AI prompt uses to
// explain itself ONLY when the capability is actually enabled for
// this chatbot (see services/sectors/index.js's dynamic instruction).
export const MARKETING_CAPABILITIES = [
  { key: "knowledge_assistant", label: "Digital Marketing Knowledge Assistant", description: "Answer general marketing questions and explain concepts." },
  { key: "seo_assistant", label: "Basic SEO Assistant", description: "SEO recommendations, keyword suggestions, meta title/description generation, on-page guidance." },
  { key: "social_media_assistant", label: "Social Media Assistant", description: "Post ideas, captions, hashtags, reels scripts, content calendars." },
  { key: "content_generator", label: "AI Content Generator", description: "Generate blogs, website/landing copy, ad copy, email content, scripts, CTAs." },
  { key: "campaign_assistant", label: "Marketing Campaign Assistant", description: "Suggest campaign ideas, objectives, audiences, ad copy, and channel recommendations as advice only — never creates or publishes real campaigns." },
  { key: "metrics_calculator", label: "Marketing Metrics Calculator", description: "Deterministic ROI/ROAS/CPC/CPM/CTR/CPL/CPA/CAC/conversion/engagement calculations via the built-in calculator." },
  { key: "performance_analysis", label: "Marketing ROI / Performance Analysis", description: "Combines whichever metrics the visitor has numbers for into one performance view, with general industry-benchmark commentary — all from the deterministic calculator, never invented." },
  { key: "lead_generation", label: "Lead Generation & Qualification", description: "Collect and qualify visitor leads." },
  { key: "competitor_analysis", label: "Basic Competitor Analysis", description: "Compare positioning/services/content against a competitor URL the visitor provides, clearly separating verified facts from estimates." },
  { key: "strategy_planner", label: "Marketing Strategy & Budget Planner", description: "Generate marketing strategies, channel recommendations, and monthly plans as clearly-labeled estimates." },
];

export const MARKETING_CAPABILITY_KEYS = MARKETING_CAPABILITIES.map((c) => c.key);
