const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const cors = require('cors');
const path = require('path');  // Correctly import path module
const fs = require('fs');  // Import fs module for file operations
require('dotenv').config({ path: './backend/.env' });  // ✅ Ensure correct path

// ✅ Debug: Check if PRIVATE_KEY is loaded correctly
if (!process.env.PRIVATE_KEY) {
    throw new Error("⚠️ PRIVATE_KEY is missing or not loaded!");
}

const app = express();
const port = process.env.PORT || 3000;

// ✅ Load frontend & backend URLs from .env
const FRONTEND_URL_LOCAL = process.env.FRONTEND_URL_LOCAL;
const FRONTEND_URL_PROD = process.env.FRONTEND_URL_PROD;
const API_URL = process.env.PORT === "3000" ? process.env.API_URL : process.env.API_URL_PROD;

// ✅ Allow frontend access from Localhost and Vercel
const allowedOrigins = [
    FRONTEND_URL_LOCAL,  // ✅ Localhost (Live Server)
    FRONTEND_URL_PROD     // ✅ Vercel Frontend
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("⚠️ CORS policy: Unauthorized request!"));
        }
    },
    optionsSuccessStatus: 200,
};

app.use(cors(corsOptions)); // ✅ Enable CORS globally
app.use(bodyParser.json());

// ✅ Serve static files from "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Inject environment variables into HTML
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(filePath, 'utf8');
    html = html.replace('{{API_URL}}', API_URL);
    res.send(html);
});

// ✅ Serve API URL dynamically
app.get('/config', (req, res) => {
    res.json({ api_url: API_URL });
});

// ✅ Ethereum setup
const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const nonceManager = new ethers.NonceManager(wallet);

const pendingTransactions = new Map();
const usedNonces = new Set();  // ✅ Track used nonces

// ✅ Process a transaction
async function processTransaction(score, address) {
    try {
        // ✅ Fetch nonce only once and track it
        const nonce = await nonceManager.getNonce();
        if (!usedNonces.has(nonce)) {
            console.log(`🚀 Using Nonce: ${nonce} for score ${score}`);
            usedNonces.add(nonce);
        }

        const feeData = await provider.getFeeData();
        if (!feeData.maxPriorityFeePerGas || !feeData.maxFeePerGas) {
            throw new Error("⚠️ Could not fetch gas fee data.");
        }

        const OWNER_WALLET = process.env.OWNER_WALLET;  // ✅ Your wallet address in .env
        const tx = {
            to: OWNER_WALLET,  // ✅ Send funds to YOUR wallet instead of the user
            value: ethers.parseEther('0.0001'),  // Amount received per jump
            gasLimit: 21000,
            nonce: nonce,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            maxFeePerGas: feeData.maxFeePerGas,
        };

        const transactionResponse = await nonceManager.sendTransaction(tx);
        console.log(`✅ Transaction sent for jump score ${score}: ${transactionResponse.hash}`);

        pendingTransactions.set(transactionResponse.hash, { nonce, score, address });

        transactionResponse.wait().then((receipt) => {
            console.log(`✅ Confirmed in block ${receipt.blockNumber}: ${transactionResponse.hash}`);
            pendingTransactions.delete(transactionResponse.hash);
        }).catch((error) => {
            console.error("❌ Transaction failed after sending:", error);
        });

        return { success: true, transactionHash: transactionResponse.hash };

    } catch (error) {
        console.error('❌ Transaction failed:', error);
        return { success: false, error: error.message };
    }
}

// ✅ Retry pending transactions
async function retryPendingTransactions() {
    console.log("🔄 Checking for pending transactions...");
    let foundPending = false;

    for (const [txHash, data] of pendingTransactions) {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) {
            console.log(`⚠️ Resending unconfirmed transaction: ${txHash}`);
            await processTransaction(data.score, data.address);
            foundPending = true;
        } else {
            console.log(`✅ Transaction already confirmed: ${txHash}`);
            pendingTransactions.delete(txHash);
        }
    }

    if (!foundPending) {
        console.log("✅ No pending transactions found.");
    }
}

// ✅ Endpoint to handle jump actions
app.post('/jump', async (req, res) => {
    const { score, address } = req.body;
    console.log(`🚀 Processing jump for score ${score}, address: ${address}`);

    const transactionData = await processTransaction(score, address);

    res.status(202).send({
        success: transactionData.success,
        message: transactionData.success ? "Transaction sent successfully." : "Transaction failed.",
        transactionHash: transactionData.transactionHash || null,
        error: transactionData.error || null,
        logs: [
            `Score: ${score}`,
            `Sender: ${address}`,
            `Transaction Hash: ${transactionData.transactionHash || "N/A"}`,
            `Status: ${transactionData.success ? "✅ Success" : "❌ Failed"}`
        ]
    });
});

// ✅ Start the server
app.listen(port, async () => {
    console.log(`🔥 Relayer server running at ${API_URL}`);
    await retryPendingTransactions();
    
});
