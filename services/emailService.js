const { Resend } = require("resend");

const resend     = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || "NovaBuk <noreply@novabuk.com>";
const APP_NAME   = "NovaBuk";
const FRONTEND   = process.env.FRONTEND_URL || "https://novabuk.vercel.app";

const sendEmail = async ({ to, subject, html }) => {
  const { data, error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  if (error) { 
    console.error("❌ Email failed for:", to);
    console.error("❌ Resend Error Details:", JSON.stringify(error, null, 2));
    throw new Error(error.message); 
  }
  console.log("✅ Email sent successfully to:", to, "(ID:", data.id, ")");
  return data;
};

const wrap = (body) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Poppins,Arial,sans-serif;">
<div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
<div style="background:linear-gradient(135deg,#7ecad7,#35bac9);padding:28px 40px;">
<h1 style="margin:0;color:white;font-size:22px;font-weight:700;">${APP_NAME}</h1>
<p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:12px;">Empowering Africa's Healthcare</p>
</div>
<div style="padding:36px 40px;">${body}</div>
<div style="background:#f8f9fa;padding:18px 40px;border-top:1px solid #eee;text-align:center;">
<p style="margin:0;color:#aaa;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} ${APP_NAME} HealthTech. All rights reserved.<br/>${APP_NAME} does not replace professional medical advice.</p>
</div></div></body></html>`;

const badge = (s) => {
  const c = { Pending:{bg:"#fff3cd",t:"#856404"}, Confirmed:{bg:"#d1ecf1",t:"#0c5460"}, Completed:{bg:"#d4edda",t:"#155724"}, Cancelled:{bg:"#f8d7da",t:"#721c24"} }[s] || {bg:"#eee",t:"#333"};
  return `<span style="display:inline-block;background:${c.bg};color:${c.t};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${s}</span>`;
};

const ctaBtn = (text, url) => `<div style="margin-top:24px;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#7ecad7,#35bac9);color:white;text-decoration:none;padding:13px 30px;border-radius:8px;font-weight:600;font-size:14px;">${text}</a></div>`;

// ── PATIENT EMAILS ───────────────────────────────────────────

const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Reset your password</h2>
    <p style="color:#555;line-height:1.7;margin:0 0 24px;">Hi ${name}, click below to reset your password. This link expires in <strong>1 hour</strong>.</p>
    ${ctaBtn("Reset Password", resetUrl)}
    <p style="color:#aaa;font-size:12px;margin-top:20px;">If you didn't request this, ignore this email.</p>
  `);
  return sendEmail({ to, subject: `Reset your ${APP_NAME} password`, html });
};

const sendOTPEmail = async ({ to, name, otpCode }) => {
  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Verify your account</h2>
    <p style="color:#555;line-height:1.7;margin:0 0 24px;">Hi ${name}, please use the code below to complete your NovaBuk registration. This code expires in <strong>15 minutes</strong>.</p>
    <div style="background:#f0f9fa; border: 2px dashed #35bac9; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #35bac9;">${otpCode}</span>
    </div>
    <p style="color:#aaa;font-size:12px;margin-top:20px;">If you didn't request this, ignore this email.</p>
  `);
  console.log("OTP Sent to:", to, "Code:", otpCode);
  return sendEmail({ to, subject: `${otpCode} is your ${APP_NAME} verification code`, html });
};

const sendWelcomeEmail = async ({ to, name, novaBukId }) => {
  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Welcome to ${APP_NAME}, ${name}! 👋</h2>
    <p style="color:#555;line-height:1.7;margin:0 0 20px;">Your account is ready. Log symptoms, find clinics, and manage your health records — all in one place.</p>
    <div style="background:#f0f9fa;border-radius:12px;padding:18px 20px;margin-bottom:20px;border:1px solid #35bac9;">
      <p style="margin:0;font-size:11px;color:#35bac9;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Your Unique NovaBuk ID</p>
      <p style="margin:5px 0 0;font-size:24px;font-weight:700;color:#0f2027;">${novaBukId || "Pending"}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#718096;line-height:1.4;">Show this ID at any NovaBuk clinic for instant check-in.</p>
    </div>
    <div style="background:#e8f8fb;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
      <p style="margin:0 0 10px;font-weight:600;color:#0f2027;font-size:14px;">Get started:</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">✅ Complete your health profile</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">✅ Log your first symptoms</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">✅ Find and book a nearby clinic</p>
    </div>
    ${ctaBtn("Open NovaBuk", `${FRONTEND}/app-home.html`)}
  `);
  return sendEmail({ to, subject: `Welcome to ${APP_NAME}!`, html });
};

const sendVisitConfirmationEmail = async ({ to, name, clinicName, status, preferredDate, diagnosis, advice }) => {
  const dateStr = preferredDate
    ? new Date(preferredDate).toLocaleDateString("en-NG", { weekday:"long", day:"numeric", month:"long", year:"numeric" })
    : null;

  const msgs = {
    Pending:   { h:"Visit Request Submitted",    b:`Your request to <strong>${clinicName}</strong> has been submitted. The clinic will confirm shortly.`, ctaT:"View My Visits", cta:`${FRONTEND}/app-history.html` },
    Confirmed: { h:"Your Visit is Confirmed ✓",  b:`<strong>${clinicName}</strong> has confirmed your visit.${dateStr?` Please arrive on <strong>${dateStr}</strong>.`:""}`, ctaT:"View Details", cta:`${FRONTEND}/app-history.html` },
    Completed: { h:"Consultation Complete",       b:`Your visit at <strong>${clinicName}</strong> is complete. Your notes are now available.${diagnosis?`<br/><br/><strong>Diagnosis:</strong> ${diagnosis}`:""}${advice?`<br/><strong>Advice:</strong> ${advice}`:""}`, ctaT:"View My Notes", cta:`${FRONTEND}/app-history.html` },
    Cancelled: { h:"Visit Cancelled",             b:`Your visit to <strong>${clinicName}</strong> was cancelled. Book again when you're ready.`, ctaT:"Book Again", cta:`${FRONTEND}/app-clinics.html` },
  };

  const m = msgs[status];
  if (!m) return;

  const subjects = { Pending:`Visit request — ${clinicName}`, Confirmed:`Your visit at ${clinicName} is confirmed ✓`, Completed:`Consultation complete — ${clinicName}`, Cancelled:`Visit at ${clinicName} cancelled` };

  const html = wrap(`
    <p style="color:#718096;font-size:13px;margin:0 0 4px;">Hi ${name},</p>
    <h2 style="margin:0 0 16px;color:#1a1a1a;font-size:20px;">${m.h}</h2>
    <div style="background:#f8fafc;border-left:4px solid #35bac9;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px;">
      <p style="margin:0;color:#4a5568;line-height:1.7;font-size:14px;">${m.b}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      <tr><td style="padding:8px 0;border-bottom:1px solid #f5f5f5;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.5px;width:100px;">Clinic</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5;font-weight:600;color:#0f2027;font-size:13px;">${clinicName}</td></tr>
      ${dateStr?`<tr><td style="padding:8px 0;border-bottom:1px solid #f5f5f5;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Date</td><td style="padding:8px 0;border-bottom:1px solid #f5f5f5;color:#0f2027;font-size:13px;">${dateStr}</td></tr>`:""}
      <tr><td style="padding:8px 0;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Status</td><td style="padding:8px 0;">${badge(status)}</td></tr>
    </table>
    ${ctaBtn(m.ctaT, m.cta)}
  `);
  return sendEmail({ to, subject: subjects[status], html });
};

// ── DOCTOR / CLINIC EMAILS ───────────────────────────────────

const sendDoctorWelcomeEmail = async ({ to, doctorName, clinicName }) => {
  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Your clinic is live, Dr. ${doctorName}! 🎉</h2>
    <p style="color:#555;line-height:1.7;margin:0 0 20px;"><strong>${clinicName}</strong> is now on ${APP_NAME}. Patients can find you, book appointments, and receive consultation notes digitally.</p>
    <div style="background:#e8f8fb;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
      <p style="margin:0 0 12px;font-weight:600;color:#0f2027;font-size:14px;">What happens now:</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">🔔 You'll get an email every time a patient books</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">📋 Your queue refreshes every 30 seconds automatically</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">💊 Consultation notes go to the patient on completion</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">✏️ Update clinic info and photos from Settings</p>
    </div>
    ${ctaBtn("Open My Queue", `${FRONTEND}/clinic-queue.html`)}
  `);
  return sendEmail({ to, subject: `${clinicName} is now live on ${APP_NAME}!`, html });
};

const sendDoctorNewBookingEmail = async ({ to, doctorName, patientName, clinicName, preferredDate, notes }) => {
  const dateStr = preferredDate
    ? new Date(preferredDate).toLocaleDateString("en-NG", { weekday:"long", day:"numeric", month:"long", year:"numeric" })
    : "Date not specified";
  const html = wrap(`
    <div style="background:#e8f8fb;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;font-weight:600;color:#0c5460;font-size:14px;">🔔 New Patient Booking — ${clinicName}</p>
    </div>
    <p style="color:#718096;font-size:13px;margin:0 0 4px;">Hi Dr. ${doctorName},</p>
    <h2 style="margin:0 0 18px;color:#1a1a1a;font-size:20px;">A new patient has booked a visit</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.5px;width:120px;">Patient</td><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;font-weight:600;color:#0f2027;">${patientName}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Preferred Date</td><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;color:#0f2027;">${dateStr}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Reason</td><td style="padding:10px 0;border-bottom:1px solid #f5f5f5;color:#0f2027;">${notes || "Not specified"}</td></tr>
      <tr><td style="padding:10px 0;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Status</td><td style="padding:10px 0;">${badge("Pending")}</td></tr>
    </table>
    ${ctaBtn("Open Clinic Queue", `${FRONTEND}/clinic-queue.html`)}
  `);
  return sendEmail({ to, subject: `New booking: ${patientName} — ${clinicName}`, html });
};

const sendDoctorCancellationEmail = async ({ to, doctorName, patientName, clinicName, preferredDate }) => {
  const dateStr = preferredDate
    ? new Date(preferredDate).toLocaleDateString("en-NG", { weekday:"long", day:"numeric", month:"long", year:"numeric" })
    : "the scheduled date";
  const html = wrap(`
    <div style="background:#fff5f5;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;font-weight:600;color:#721c24;font-size:14px;">❌ Visit Cancelled by Patient — ${clinicName}</p>
    </div>
    <p style="color:#718096;font-size:13px;margin:0 0 4px;">Hi Dr. ${doctorName},</p>
    <h2 style="margin:0 0 14px;color:#1a1a1a;font-size:20px;">${patientName} cancelled their visit</h2>
    <p style="color:#555;font-size:14px;line-height:1.7;margin-bottom:20px;">The visit scheduled for <strong>${dateStr}</strong> at <strong>${clinicName}</strong> has been cancelled. No action needed — this slot is now free.</p>
    ${ctaBtn("View Queue", `${FRONTEND}/clinic-queue.html`)}
  `);
  return sendEmail({ to, subject: `Cancellation: ${patientName}'s visit — ${clinicName}`, html });
};

const sendWalkInWelcomeEmail = async ({ to, name, clinicName, activationUrl, novaBukId }) => {
  const html = wrap(`
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Welcome to ${APP_NAME}, ${name}! 👋</h2>
    <p style="color:#555;line-height:1.7;margin:0 0 20px;">Your digital health record has been created at <strong>${clinicName}</strong>. You can now access your consultation notes and prescriptions online at any time.</p>
    
    <div style="background:#f0f9fa;border-radius:12px;padding:18px 20px;margin-bottom:24px;border:1px solid #35bac9;">
      <p style="margin:0;font-size:11px;color:#35bac9;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Your Unique NovaBuk ID</p>
      <p style="margin:5px 0 0;font-size:24px;font-weight:700;color:#0f2027;">${novaBukId || "Pending"}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#718096;line-height:1.4;">Give this ID to any NovaBuk provider to instantly pull up your history.</p>
    </div>

    <div style="background:#e8f8fb;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
      <p style="margin:0 0 10px;font-weight:600;color:#0f2027;font-size:14px;">Next steps:</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">🔑 Set your password to activate your account</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">📋 View your diagnosis and prescriptions</p>
      <p style="margin:4px 0;color:#4a5568;font-size:13px;">🔔 Get notified for follow-up visits</p>
    </div>
    ${ctaBtn("Set Password & View Records", activationUrl)}
    <p style="color:#aaa;font-size:12px;margin-top:24px;">If you didn't visit ${clinicName} recently, please ignore this email.</p>
  `);
  return sendEmail({ to, subject: `Your health records at ${clinicName} are ready on ${APP_NAME}`, html });
};

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendVisitConfirmationEmail,
  sendWalkInWelcomeEmail,
  sendDoctorWelcomeEmail,
  sendDoctorNewBookingEmail,
  sendDoctorCancellationEmail,
  sendOTPEmail,
};