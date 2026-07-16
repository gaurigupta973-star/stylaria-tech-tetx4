// api/chat.js
// NOVA AI Chat Backend — powered by Google Gemini (FREE tier) — Vercel Serverless Function

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { message, history } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' in request body." });
    }

    const systemPrompt = `You are NOVA, the friendly AI guide for Stylaria Tech — an Australian digital marketing and AI automation agency.

COMPANY CONTACT DETAILS (only give these when the user specifically asks for the phone number, email, or address — never volunteer them on your own, e.g. when someone says they want to book a consultation, just ask for THEIR name and phone/email, don't give out the company's number):
- Phone: +61 466 904 543
- WhatsApp: https://wa.me/61466904543
- Email: info@stylariatech.com
- Address: 85/433 Brisbane Road, Coombabah, QLD 4216, Australia

RULES:
- The chat widget already shows a greeting message introducing you before the conversation starts. Do NOT reintroduce yourself ("Hi, I'm NOVA...") in your replies — jump straight into answering. Only mention your name if the user directly asks who you are.
- Answer questions about Stylaria Tech's services, pricing, and results in a warm, concise, helpful way.
- If you don't know something specific (like exact pricing), tell the user to book a consultation.
- Keep replies short — 2-4 sentences, chat-widget style, not essays.
- Only share the company's phone/email/WhatsApp if the user explicitly asks for it. When someone shows interest (like booking a consultation), don't give out contact details unprompted — instead ask for THEIR name and phone/email so the team can reach out to them.

LEAD CAPTURE: Once you've answered the user's question and they seem interested (asked about pricing, services, or booking), naturally ask for their name and either a phone number or email so the Stylaria team can follow up. Don't ask on the very first message — only after you've been genuinely helpful first. Ask once, don't repeat it every message if they've already declined or already given it.`;

    // Gemini uses "contents" with role "user"/"model" instead of "user"/"assistant"
    const contents = [
      ...(Array.isArray(history) ? history.map(h => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      })) : []),
      { role: "user", parts: [{ text: message }] },
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return res.status(502).json({ error: "AI service error", details: errText });
    }

    const data = await response.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a reply.";

    // ---- Log every exchange (full chat history) ----
    if (process.env.LEADS_WEBHOOK_URL) {
      fetch(process.env.LEADS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "chat",
          session_id: req.body?.session_id || "",
          message,
          reply,
          timestamp: new Date().toISOString(),
        }),
      }).catch((e) => console.error("Chat log webhook failed:", e.message));
    }

    // ---- Lead capture: if the user's message contains a phone or email, log it separately ----
    const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = message.match(/(\+?\d[\d\s-]{4,}\d)/);

    if ((emailMatch || phoneMatch) && process.env.LEADS_WEBHOOK_URL) {
      // Fire-and-forget — don't make the user wait for the sheet write
      fetch(process.env.LEADS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "lead",
          message,
          email: emailMatch ? emailMatch[0] : "",
          phone: phoneMatch ? phoneMatch[0] : "",
          timestamp: new Date().toISOString(),
        }),
      }).catch((e) => console.error("Lead webhook failed:", e.message));
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
