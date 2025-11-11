// 正确的腾讯企业邮箱SMTP配置示例
const nodemailer = require('nodemailer');

// 配置1: 使用端口465 (SSL)
const config465 = {
    host: 'smtp.exmail.qq.com',
    port: 465,
    secure: true, // 使用SSL
    auth: {
        user: 'service@aiwetalk.com',
        pass: 'nHQXPgvA96W3KxWL'
    }
};

// 配置2: 使用端口587 (STARTTLS)
const config587 = {
    host: 'smtp.exmail.qq.com',
    port: 587,
    secure: false, // 不使用SSL，使用STARTTLS
    auth: {
        user: 'service@aiwetalk.com',
        pass: 'nHQXPgvA96W3KxWL'
    }
};

// 创建transporter的函数
function createTransporter(useSSL = true) {
    const config = useSSL ? config465 : config587;

    const transporter = nodemailer.createTransport(config);

    // 添加错误处理
    transporter.on('error', (error) => {
        console.error('SMTP连接错误:', error);
    });

    return transporter;
}

// 发送验证码邮件的函数
async function sendVerificationCode(email, code) {
    try {
        // 先尝试SSL连接，如果失败再尝试STARTTLS
        let transporter = createTransporter(true);

        try {
            await transporter.verify();
        } catch (sslError) {
            console.log('SSL连接失败，尝试STARTTLS...');
            transporter = createTransporter(false);
            await transporter.verify();
        }

        const mailOptions = {
            from: 'service@aiwetalk.com',
            to: email,
            subject: '邮箱验证码',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">邮箱验证码</h2>
                    <p>您的验证码是：</p>
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; font-size: 24px; font-weight: bold; text-align: center; color: #e74c3c;">
                        ${code}
                    </div>
                    <p style="color: #666; font-size: 12px;">此验证码10分钟内有效，请勿泄露给他人。</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('验证码邮件发送成功:', info.messageId);
        return true;

    } catch (error) {
        console.error('发送验证码邮件失败:', error);
        throw new Error('邮件发送失败，请稍后重试');
    }
}

module.exports = { sendVerificationCode };