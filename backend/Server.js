const express = require('express');
const bodyParser = require('body-parser');
const { ethers } = require('ethers');
const cors = require('cors');
const path = require('path'); // Correctly import the 'path' module
const fs = require('fs'); // Import the 'fs' module for file operations

require('dotenv').config({ path: './backend/.env' }); // ✅ Ensure correct path

// ✅ Debug: Check if PRIVATE_KEY is loaded correctly
if (!process.env.PRIVATE_KEY) {
    throw new Error("⚠️ PRIVATE_KEY is missing or not loaded!");
}

const app = express();
const port = process.env.PORT || 3000;
const corsOptions = {
    origin: "*", 
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE"
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json());

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Inject environment variables into the HTML
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(filePath, 'utf8');

    // Replace placeholders with environment variables
    html = html.replace('{{API_URL}}', process.env.API_URL_PROD || 'http://localhost:3000');

    res.send(html);
});

// Ethereum setup
const provider = new ethers.JsonRpcProvider('https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const nonceManager = new ethers.NonceManager(wallet);

const pendingTransactions = new Map();
const usedNonces = new Set(); // Track used nonces

// ✅ Process a transaction
async function processTransaction(score, address) {
    try {
        // ✅ Fetch nonce only once and track it
        const nonce = await nonceManager.getNonce();
        if (!usedNonces.has(nonce)) {
            console.log(`🚀 Using Nonce: ${nonce} for score ${score}`);
            usedNonces.add(nonce); // Track logged nonces to prevent duplicate logs
        }

        const feeData = await provider.getFeeData();
        if (!feeData.maxPriorityFeePerGas || !feeData.maxFeePerGas) {
            throw new Error("⚠️ Could not fetch gas fee data.");
        }

        const tx = {
            to: address,
            value: ethers.parseEther('0.0001'),
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

// Retry pending transactions
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

// Endpoint to handle jump actions
app.post('/jump', async (req, res) => {
    const { score, address } = req.body;
    const transactionPromise = processTransaction(score, address);

    res.status(202).send({
        success: true,
        message: "Transaction queued for processing.",
    });

    await transactionPromise;
});

// Start the server
app.listen(port, async () => {
    console.log(`🔥 Relayer server running at http://localhost:${port}`);
    await retryPendingTransactions();
});