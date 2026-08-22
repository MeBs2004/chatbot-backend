import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Company from "../models/company.model.js";

async function seedDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("✅ MongoDB Connected");

    // Remove old companies
    await Company.deleteMany({});

    // =============================
    // Nuform Social
    // =============================

    await Company.create({
      companyId: "nuform-social",

      name: "Nuform Social",

      domain: "https://www.nuformsocial.com",

      website: "https://www.nuformsocial.com",

      branding: {
        logo: "/logo.png",
        favicon: "/favicon.ico",
        launcherIcon: "/logo.png",
        botAvatar: "/logo.png",
      },

      theme: {
        primaryColor: "#067647",
        secondaryColor: "#0d5537",
        accentColor: "#e36b0a",

        backgroundColor: "#f7f7f7",
        textColor: "#333333",

        userBubbleColor: "#067647",
        botBubbleColor: "#ffffff",

        headerGradientFrom: "#067647",
        headerGradientTo: "#0d5537",

        borderRadius: 18,
        fontFamily: "Inter",
      },

      chatbot: {
        chatbotName: "Nuform AI",
        botName: "Nuform AI",

        greetingMessage:
          "👋 Welcome to Nuform Social! How can we help you today?",

        placeholder: "Ask me anything...",

        poweredBy: true,
      },

      knowledgeFile: "knowledge.txt",

      suggestions: {
        English: [
          "What services do you offer?",
          "Tell me about SEO",
          "Website development details",
          "Performance marketing info",
          "Social media services",
          "Corporate AV production",
          "Mobile app development",
          "Get a quick audit",
          "What's your tech stack?",
          "Contact & office location",
        ],

        Hindi: [
          "आप कौन-कौन सी सेवाएँ देते हैं?",
          "SEO के बारे में बताइए",
          "वेबसाइट डेवलपमेंट",
          "परफॉर्मेंस मार्केटिंग",
          "सोशल मीडिया सेवाएँ",
          "कॉर्पोरेट AV",
          "मोबाइल ऐप डेवलपमेंट",
          "क्विक ऑडिट",
          "आपका टेक स्टैक",
          "संपर्क जानकारी",
        ],
      },

      contact: {
        phone: "+91-9902421936",
        whatsapp: "+91-9902421936",
        email: "info@nuformsocial.com",
        address: "Bengaluru, India",
      },

      ai: {
        provider: "groq",
        language: "English",
        model: "openai/gpt-oss-20b",
        temperature: 0.3,
        maxTokens: 500,

        systemPrompt: `
You are Nuformly, the official AI assistant of Nuform Social.

Be professional, friendly and modern.

Only answer questions related to Nuform Social.

Help users with:

• Website Development
• Mobile App Development
• Digital Marketing
• SEO
• Branding
• Social Media Marketing
• Performance Marketing
• Corporate AV
• Technology

Never answer unrelated questions.
`,
      },

      webhook: {
        enabled: false,
        url: "",
        secret: "",
      },

      isActive: true,
    });

    // =============================
    // OYA by Gemkara
    // =============================

    await Company.create({
      companyId: "oya-gemkara",

      name: "OYA by Gemkara",

      domain: "https://www.oyabygemkara.com",

      website: "https://www.oyabygemkara.com",

      branding: {
        logo: "/oya/logo.png",
        favicon: "/oya/favicon.ico",
        launcherIcon: "/oya/logo.png",
        botAvatar: "/oya/logo.png",
      },

      theme: {
        primaryColor: "#5E0F28",
        secondaryColor: "#5E0F28",
        accentColor: "#5E0F28",

        backgroundColor: "#ffffff",
        textColor: "#333333",

        userBubbleColor: "#5E0F28",
        botBubbleColor: "#ffffff",

        headerGradientFrom: "#5E0F28",
        headerGradientTo: "#5E0F28",

        borderRadius: 18,
        fontFamily: "Inter",
      },

      chatbot: {
        chatbotName: "OYA Assistant",
        botName: "OYA",

        greetingMessage:
          "👋 Welcome to OYA by Gemkara. How may I assist you today?",

        placeholder: "Ask OYA...",

        poweredBy: false,
      },

      knowledgeFile: "oya-knowledge.txt",

      suggestions: {
        English: [
          "Tell me about OYA",
          "Jewellery Collection",
          "Gemstone Recommendation",
          "Book an Appointment",
          "Store Location",
          "Contact Support",
        ],

        Hindi: [
          "OYA के बारे में बताइए",
          "ज्वेलरी कलेक्शन",
          "रत्न की सलाह",
          "अपॉइंटमेंट बुक करें",
          "स्टोर लोकेशन",
          "संपर्क करें",
        ],
      },

      contact: {
        phone: "",
        whatsapp: "",
        email: "",
        address: "",
      },

      ai: {
        provider: "groq",
        language: "English",
        model: "openai/gpt-oss-20b",
        temperature: 0.3,
        maxTokens: 500,

        systemPrompt: `
You are OYA, the official AI assistant of OYA by Gemkara.

Help customers with jewellery and gemstones.

Never invent prices.

Never invent stock availability.

If information isn't available, politely ask users to contact OYA by Gemkara.
`,
      },

      webhook: {
        enabled: false,
        url: "",
        secret: "",
      },

      isActive: true,
    });

    console.log("✅ Nuform Social Seeded");
    console.log("✅ OYA by Gemkara Seeded");

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seedDatabase();