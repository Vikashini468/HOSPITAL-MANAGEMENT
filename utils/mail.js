const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendOTP(email, otp) {
    await transporter.sendMail({
        from: "NALAM AI <no-reply@gmail.com>",
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP is ${otp}`
    });
}

module.exports = sendOTP;