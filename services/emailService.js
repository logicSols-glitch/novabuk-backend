/**
 * NovaBuk Email Service
 * ─────────────────────────────────────────────────────────
 * Currently uses Resend (resend.com).
 *
 * TO SWITCH TO SENDGRID LATER:
 *   1. npm install @sendgrid/mail
 *   2. Replace the sendEmail function below with the SendGrid version
 *   3. Update .env: replace RESEND_API_KEY with SENDGRID_API_KEY
 *   4. Nothing else changes — all routes call sendEmail() the same way
 * ─────────────────────────────────────────────────────────
 */

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "NovaBuk <onboarding@resend.dev>";
// const FROM_EMAIL = process.env.FROM_EMAIL || "NovaBuk <noreply@novabuk.com>";
const APP_NAME = "NovaBuk";

/**
 * Core send function — all emails go through here.
 * To switch providers, only edit this function.
 */
const sendEmail = async ({ to, subject, html }) => {
  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });

  if (error) {
    console.error("Email send error:", error);
    throw new Error(error.message || "Failed to send email");
  }

  return data;
};

/* ── SENDGRID VERSION (commented out — swap in when ready) ──
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

─────────────────────────────────────────────────────────── */

// ── EMAIL TEMPLATES ───────────────────────────────────────

/**
 * Password reset email
 */
const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
  const subject = `Reset your ${APP_NAME} password`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background:#f0f4f8;font-family:Poppins,Arial,sans-serif;">
      <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#7ecad7,#35bac9);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:white;font-size:24px;font-weight:700;">${APP_NAME}</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Digital Health Platform</p>
        </div>

        <!-- Body -->
        <div style="padding:40px;">
          <h2 style="margin:0 0 12px;color:#1a1a1a;font-size:20px;">Reset your password</h2>
          <p style="color:#555;line-height:1.6;margin:0 0 24px;">
            Hi ${name}, we received a request to reset your ${APP_NAME} password.
            Click the button below to choose a new one.
          </p>

          <div style="text-align:center;margin:32px 0;">
            <a href="${resetUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#7ecad7,#35bac9);
                      color:white;text-decoration:none;padding:14px 36px;
                      border-radius:8px;font-weight:600;font-size:15px;">
              Reset Password
            </a>
          </div>

          <p style="color:#888;font-size:13px;line-height:1.6;margin:0 0 8px;">
            This link expires in <strong>1 hour</strong>. If you didn't request a password reset,
            you can safely ignore this email — your password won't change.
          </p>

          <p style="color:#aaa;font-size:12px;margin:0;">
            Or copy this link into your browser:<br>
            <span style="color:#35bac9;word-break:break-all;">${resetUrl}</span>
          </p>
        </div>

        <!-- Footer -->
        <div style="background:#f8f9fa;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
          <p style="margin:0;color:#aaa;font-size:12px;">
            © 2025 ${APP_NAME} HealthTech. All rights reserved.<br>
            NovaBuk does not replace professional medical advice.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to, subject, html });
};

/**
 * Welcome email sent after successful registration
 */
const sendWelcomeEmail = async ({ to, name }) => {
  const subject = `Welcome to ${APP_NAME} 👋`;

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#f0f4f8;font-family:Poppins,Arial,sans-serif;">
      <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        
        <div style="background:linear-gradient(135deg,#7ecad7,#35bac9);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:white;font-size:24px;font-weight:700;">${APP_NAME}</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Digital Health Platform</p>
        </div>

        <div style="padding:40px;">
          <h2 style="margin:0 0 12px;color:#1a1a1a;font-size:20px;">Welcome, ${name}! 🎉</h2>
          <p style="color:#555;line-height:1.6;margin:0 0 20px;">
            Your ${APP_NAME} account is ready. You can now log your symptoms,
            find nearby clinics, and manage your health — all in one place.
          </p>
          <p style="color:#888;font-size:13px;line-height:1.6;">
            ${APP_NAME} does not replace professional medical advice. 
            Always consult a qualified healthcare provider for medical decisions.
          </p>
        </div>

        <div style="background:#f8f9fa;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
          <p style="margin:0;color:#aaa;font-size:12px;">
            © 2025 ${APP_NAME} HealthTech. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to, subject, html });
};

/**
 * Visit request confirmation to patient
 */
const sendVisitConfirmationEmail = async ({ to, name, clinicName, status, preferredDate }) => {
  const subject = `Your visit request — ${clinicName}`;

  const statusColor = {
    Pending:   "#f39c12",
    Confirmed: "#27ae60",
    Cancelled: "#e74c3c",
    Completed: "#35bac9",
  }[status] || "#35bac9";

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#f0f4f8;font-family:Poppins,Arial,sans-serif;">
      <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        
        <div style="background:linear-gradient(135deg,#7ecad7,#35bac9);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:white;font-size:24px;font-weight:700;">${APP_NAME}</h1>
        </div>

        <div style="padding:40px;">
          <h2 style="margin:0 0 12px;color:#1a1a1a;font-size:20px;">Visit Request Update</h2>
          <p style="color:#555;line-height:1.6;margin:0 0 24px;">Hi ${name},</p>

          <div style="background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:24px;">
            <p style="margin:0 0 8px;color:#888;font-size:13px;">CLINIC</p>
            <p style="margin:0 0 16px;color:#1a1a1a;font-weight:600;">${clinicName}</p>
            <p style="margin:0 0 8px;color:#888;font-size:13px;">STATUS</p>
            <span style="display:inline-block;background:${statusColor};color:white;
                         padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;">
              ${status}
            </span>
            ${preferredDate ? `
            <p style="margin:16px 0 4px;color:#888;font-size:13px;">PREFERRED DATE</p>
            <p style="margin:0;color:#1a1a1a;">${new Date(preferredDate).toLocaleDateString("en-NG", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}</p>
            ` : ""}
          </div>

          <p style="color:#888;font-size:13px;line-height:1.6;">
            Log in to your ${APP_NAME} account to view full details or cancel this request.
          </p>
        </div>

        <div style="background:#f8f9fa;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
          <p style="margin:0;color:#aaa;font-size:12px;">© 2025 ${APP_NAME} HealthTech. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({ to, subject, html });
};

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendVisitConfirmationEmail,
};
