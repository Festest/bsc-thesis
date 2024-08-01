const functions = require('firebase-functions');
const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());

// MongoDB's connection settings
const mongoUri = 'YOUR_MONGODB_URI';
let client;
let collection;

const connectToMongoDB = async () => {
    if (!client || !client.topology || client.topology.isDestroyed()) {
        client = new MongoClient(mongoUri);
        await client.connect();
        collection = client.db('survey').collection('responses');
    }
};

// Helper function to generate a random token
const generateToken = () => crypto.randomBytes(8).toString('hex');

app.get('/api/questionnaire-type', async (req, res) => {
    try {
        await connectToMongoDB()
        const { token } = req.query;
        const ip = req.headers['x-forwarded-for'].split(',')[0].trim() || req.connection.remoteAddress;

        // Check if there's already an entry with the same IP or token
        const existingEntry = await collection.findOne({ $or: [{ ip }, { token }] });

        if (existingEntry && (((token === "undefined" || token === null) && existingEntry.ip === ip) || (token !== "undefined" && token !== null))) {
            const aiScore = calculateAiScore(existingEntry.type, existingEntry.answers)
            const legitimacyScore = calculateLegitScore(existingEntry.type, existingEntry.answers)
            const avgScore = (aiScore + legitimacyScore) / 2
            return res.status(200).json({ type: -1, token: existingEntry['token'], aiScore, legitimacyScore, avgScore });
        }

        const countType0 = await collection.countDocuments({ type: 0 });
        const countType1 = await collection.countDocuments({ type: 1 });
        const newToken = (!token || token === "undefined") ? generateToken() : token;

        res.status(200).json({ type: (countType0 <= countType1) ? 0 : 1, token: newToken });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/submit-questionnaire', async (req, res) => {
    try {
        await connectToMongoDB()
        const ip = req.headers['x-forwarded-for'].split(',')[0].trim() || req.connection.remoteAddress;
        const { type, token, answers } = req.body;
        const time = Date.now()

        if (type == null || token == null || answers == null) {
            return res.status(400).json({ error: `Missing required fields`  });
        }

        // Save the document to MongoDB
        await collection.insertOne({ ip, time, type, token, answers });
        const aiScore = calculateAiScore(type, answers);
        const legitimacyScore = calculateLegitScore(type, answers)
        const avgScore = (aiScore + legitimacyScore) / 2;

        res.status(200).json({ aiScore, legitimacyScore, avgScore });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

function calculateAiScore(type, answers) {
    let score

    if (type === 0){
        score =
            (10 - parseInt(answers.email1.aiScore)) +
            (10 - parseInt(answers.email2.aiScore)) +
            (parseInt(answers.email3.aiScore)) +
            (parseInt(answers.email4.aiScore))
    }
    else {
        score =
            (parseInt(answers.email1.aiScore)) +
            (parseInt(answers.email2.aiScore)) +
            (10 - parseInt(answers.email3.aiScore)) +
            (10 - parseInt(answers.email4.aiScore))
    }

    return score / 4;
}

function calculateLegitScore(type, answers) {
    const score =
        (10 - parseInt(answers.email1.legitimacyScore)) +
        (parseInt(answers.email2.legitimacyScore)) +
        (parseInt(answers.email3.legitimacyScore)) +
        (10 - parseInt(answers.email4.legitimacyScore))

    return score / 4;
}

exports.app = functions.https.onRequest(app);
