import EducationCategory from "../../models/education/category.model.js";
import EducationFAQ from "../../models/education/faq.model.js";

// ======================================================
// PLATFORM DEFAULTS for the Education vertical — seeded once via
// ensureEducationDefaults() and from then on editable like any other
// row by a Super Admin. Mirrors energyDefaults.service.js exactly:
// idempotent upserts (never overwrite something already edited),
// auto-run on every backend boot (see index.js) so a fresh environment
// never has an empty catalog the way Energy's did before that bug fix.
// ======================================================

export const CATEGORY_DEFAULTS = [
  { key: "admissions", label: "Admissions", icon: "FiUserCheck" },
  { key: "fees", label: "Fees", icon: "FiDollarSign" },
  { key: "facility", label: "Facility & Hostel", icon: "FiHome" },
  { key: "placements", label: "Placements", icon: "FiBriefcase" },
  { key: "scholarships", label: "Scholarships", icon: "FiAward" },
  { key: "courses", label: "Courses & Programs", icon: "FiBookOpen" },
  { key: "general", label: "General Inquiries", icon: "FiHelpCircle" },
];

export const FAQ_DEFAULTS = {
  admissions: [
    { question: "What documents are needed for admission?", answer: "Typically you'll need your previous academic transcripts/mark sheets, a government-issued photo ID, passport-size photographs, and any entrance exam scorecard if applicable. Exact requirements vary by program — our admissions team can confirm the full list for the course you're interested in." },
    { question: "What is the application process?", answer: "You submit an application with your academic details, it's reviewed against the program's eligibility criteria, and shortlisted candidates are invited for the next step (interview, entrance test, or direct offer depending on the program). Use the \"Get Free Counselling\" option here and our team will guide you through every step." },
    { question: "Is there an entrance exam?", answer: "Some programs require an entrance exam or merit-based shortlisting, others are direct-admission. This depends on the specific course — ask about the course you're interested in and we'll confirm." },
  ],
  fees: [
    { question: "Are fees refundable if I withdraw?", answer: "Refund policies vary by program and how far along the academic term you withdraw. Generally, withdrawing before the term starts gets a larger refund than withdrawing after classes begin. Our counselling team can share the exact refund schedule for your program." },
    { question: "Are there installment/EMI options for fees?", answer: "Yes, many of our programs offer installment plans, and we also work with financing partners for education loans in some cases. Ask our counselling team for the specific options available for your course." },
    { question: "Does the fee include hostel and other charges?", answer: "Tuition fees and hostel/mess/other charges are usually listed separately so you can see exactly what's included. Ask about a specific course and we'll break down the full cost for you." },
  ],
  facility: [
    { question: "What are the hostel facilities like?", answer: "Our hostels typically include furnished rooms, Wi-Fi, mess/dining facilities, and common recreational areas — exact amenities vary by campus and room type (shared vs. single). Our team can share photos and specifics for the campus you're interested in." },
    { question: "Is transportation available?", answer: "Many of our campuses offer shuttle/bus services covering nearby areas. Ask about your specific location and we'll confirm the routes available." },
    { question: "What library and lab facilities are available?", answer: "Our campuses are equipped with libraries, computer labs, and subject-specific labs appropriate to the programs offered. Ask about a specific course for details on the facilities relevant to it." },
  ],
  placements: [
    { question: "What is the placement record like?", answer: "We work with a range of recruiting companies each year, and placement outcomes vary by program and batch. Ask our counselling team for recent placement statistics and the companies that have visited for the course you're interested in." },
    { question: "Is there a placement cell / career support?", answer: "Yes, we provide career guidance, resume support, interview preparation, and connect students with recruiting partners through our placement support process." },
  ],
  scholarships: [
    { question: "What scholarships are available?", answer: "We offer merit-based and need-based scholarships depending on the program, along with some scholarships tied to specific entrance exam scores. Our counselling team can check your eligibility for the course you're interested in." },
    { question: "How do I apply for a scholarship?", answer: "Scholarship applications are typically submitted alongside or shortly after your admission application, with supporting documents for the eligibility criteria (academic record, income proof, or exam scorecard as applicable). We can guide you through this." },
  ],
  courses: [
    { question: "What courses/programs do you offer?", answer: "We offer a range of programs — ask our counselling team or browse the course list here to see what's available, along with duration and eligibility for each." },
    { question: "Can I switch programs after enrolling?", answer: "Program transfer policies vary and usually depend on timing and eligibility. Our counselling team can advise on your specific situation." },
  ],
  general: [
    { question: "How can I contact the admissions office?", answer: "Use the \"Get Free Counselling\" option here and our team will reach out to you directly, or use the Call/WhatsApp/Email options in this chat if available." },
  ],
};

export async function ensureEducationDefaults() {
  let categoriesCreated = 0;
  let faqsCreated = 0;

  for (const category of CATEGORY_DEFAULTS) {
    const res = await EducationCategory.updateOne(
      { companyId: null, key: category.key },
      { $setOnInsert: { ...category, companyId: null, active: true } },
      { upsert: true }
    );
    if (res.upsertedCount) categoriesCreated += 1;
  }

  for (const [categoryKey, faqs] of Object.entries(FAQ_DEFAULTS)) {
    for (let order = 0; order < faqs.length; order += 1) {
      const { question, answer } = faqs[order];
      const res = await EducationFAQ.updateOne(
        { companyId: null, categoryKey, question },
        { $setOnInsert: { companyId: null, categoryKey, question, answer, order, active: true } },
        { upsert: true }
      );
      if (res.upsertedCount) faqsCreated += 1;
    }
  }

  return { categoriesCreated, faqsCreated };
}
