import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import { escapeHtml } from "./shared";

const COOKIE_NAME = "mcp-approved-clients";
const ONE_YEAR_IN_SECONDS = 31536000;
const DEFAULT_LOGO_URL = "https://docs.absmartly.com/img/logo.png";
const UNKNOWN_CLIENT_NAME = "Unknown Client";

export interface ApprovalDialogOptions {
	client: ClientInfo | null;
	server: {
		name: string;
		logo?: string;
		description?: string;
	};
	state: Record<string, any>;
}

async function importKey(secret: string): Promise<CryptoKey> {
	if (!secret) {
		throw new Error(
			"COOKIE_SECRET is not defined. A secret key is required for signing cookies.",
		);
	}
	const enc = new TextEncoder();
	return crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ hash: "SHA-256", name: "HMAC" },
		false,
		["sign", "verify"],
	);
}
async function signData(key: CryptoKey, data: string): Promise<string> {
	const enc = new TextEncoder();
	const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(data));
	return Array.from(new Uint8Array(signatureBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
async function verifySignature(
	key: CryptoKey,
	signatureHex: string,
	data: string,
): Promise<boolean> {
	const enc = new TextEncoder();
	try {
		const signatureBytes = new Uint8Array(
			signatureHex.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)),
		);
		return await crypto.subtle.verify("HMAC", key, signatureBytes.buffer, enc.encode(data));
	} catch (e) {
		console.error("Error verifying signature:", e);
		return false;
	}
}
async function getApprovedClientsFromCookie(
	cookieHeader: string | null,
	secret: string,
): Promise<string[] | null> {
	if (!cookieHeader) return null;
	const cookies = cookieHeader.split(";").map((c) => c.trim());
	const targetCookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
	if (!targetCookie) return null;
	const cookieValue = targetCookie.substring(COOKIE_NAME.length + 1);
	const parts = cookieValue.split(".");
	if (parts.length !== 2) {
		console.warn("Invalid cookie format received.");
		return null;
	}
	const [signatureHex, base64Payload] = parts;
	let payload: string;
	try {
		payload = atob(base64Payload);
	} catch {
		console.warn("Invalid base64 in approval cookie.");
		return null;
	}
	const key = await importKey(secret);
	const isValid = await verifySignature(key, signatureHex, payload);
	if (!isValid) {
		console.warn("Cookie signature verification failed.");
		return null;
	}
	try {
		const approvedClients = JSON.parse(payload);
		if (!Array.isArray(approvedClients)) {
			console.warn("Cookie payload is not an array.");
			return null;
		}
		if (!approvedClients.every((item) => typeof item === "string")) {
			console.warn("Cookie payload contains non-string elements.");
			return null;
		}
		return approvedClients as string[];
	} catch (e) {
		console.error("Error parsing cookie payload:", e);
		return null;
	}
}
export async function clientIdAlreadyApproved(
	request: Request,
	clientId: string,
	cookieEncryptionKey: string
): Promise<boolean> {
	if (!clientId) return false;
	const cookieHeader = request.headers.get("Cookie");
	const approvedClients = await getApprovedClientsFromCookie(cookieHeader, cookieEncryptionKey);
	return approvedClients?.includes(clientId) ?? false;
}
export async function parseRedirectApproval(
	request: Request,
	cookieEncryptionKey: string
): Promise<{ state: any; headers: Record<string, string> }> {
	if (request.method !== "POST") {
		throw new Error("Invalid request method. Expected POST.");
	}
	let state: any;
	let clientId: string | undefined;
	try {
		const formData = await request.formData();
		const encodedState = formData.get("state");
		if (typeof encodedState !== "string" || !encodedState) {
			throw new Error("Missing or invalid 'state' in form data.");
		}
		state = JSON.parse(atob(encodedState));
		clientId = state?.oauthReqInfo?.clientId;
		if (!clientId) {
			throw new Error("Could not extract clientId from state object.");
		}
	} catch (e) {
		console.error("Error processing form submission:", e);
		throw new Error(
			`Failed to parse approval form: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	const cookieHeader = request.headers.get("Cookie");
	const existingApprovedClients =
		(await getApprovedClientsFromCookie(cookieHeader, cookieEncryptionKey)) || [];
	const updatedApprovedClients = Array.from(new Set([...existingApprovedClients, clientId]));
	const payload = JSON.stringify(updatedApprovedClients);
	const key = await importKey(cookieEncryptionKey);
	const signature = await signData(key, payload);
	const newCookieValue = `${signature}.${btoa(payload)}`;
	const headers: Record<string, string> = {
		"Set-Cookie": `${COOKIE_NAME}=${newCookieValue}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${ONE_YEAR_IN_SECONDS}`,
	};
	return { headers, state };
}
export function renderApprovalDialog(
	request: Request,
	options: ApprovalDialogOptions
): Response {
	const { client, server, state } = options;
	const encodedState = btoa(JSON.stringify(state));
	const clientName = client?.clientName || state?.oauthReqInfo?.clientId || UNKNOWN_CLIENT_NAME;
	const html = `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>OAuth Authorization</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			max-width: 500px;
			margin: 100px auto;
			padding: 20px;
			background: #f5f5f5;
		}
		.card {
			background: white;
			border-radius: 8px;
			padding: 30px;
			box-shadow: 0 2px 10px rgba(0,0,0,0.1);
		}
		.logo {
			text-align: center;
			margin-bottom: 20px;
		}
		.logo img {
			max-width: 80px;
			height: auto;
		}
		.title {
			text-align: center;
			margin-bottom: 30px;
			color: #333;
		}
		.client-info {
			background: #f8f9fa;
			padding: 20px;
			border-radius: 6px;
			margin-bottom: 20px;
		}
		.client-name {
			font-weight: bold;
			margin-bottom: 10px;
			color: #333;
		}
		.client-description {
			color: #666;
			font-size: 14px;
			line-height: 1.4;
		}
		.permissions {
			margin: 20px 0;
		}
		.permissions h3 {
			margin-bottom: 10px;
			color: #333;
		}
		.permissions ul {
			margin: 0;
			padding-left: 20px;
		}
		.permissions li {
			margin-bottom: 5px;
			color: #666;
		}
		.buttons {
			display: flex;
			gap: 10px;
			justify-content: center;
			margin-top: 30px;
		}
		.btn {
			padding: 12px 24px;
			border: none;
			border-radius: 6px;
			cursor: pointer;
			font-size: 16px;
			text-decoration: none;
			display: inline-block;
			text-align: center;
		}
		.btn-primary {
			background: #007bff;
			color: white;
		}
		.btn-primary:hover {
			background: #0056b3;
		}
		.btn-secondary {
			background: #6c757d;
			color: white;
		}
		.btn-secondary:hover {
			background: #545b62;
		}
		.warning {
			background: #fff3cd;
			border: 1px solid #ffeaa7;
			color: #856404;
			padding: 15px;
			border-radius: 6px;
			margin-bottom: 20px;
		}
	</style>
</head>
<body>
	<div class="card">
		<div class="logo">
			<img src="${escapeHtml(server.logo || DEFAULT_LOGO_URL)}" alt="${escapeHtml(server.name)}">
		</div>
		<h1 class="title">Authorize Access</h1>
		<div class="client-info">
			<div class="client-name">${escapeHtml(clientName)}</div>
			<div class="client-description">This application is requesting access to your account.</div>
		</div>
		<div class="permissions">
			<h3>This application will be able to:</h3>
			<ul>
				<li>Access your ABsmartly experiments</li>
				<li>View experiment data and configurations</li>
				<li>Manage experiments on your behalf</li>
				<li>Access your user profile information</li>
			</ul>
		</div>
		<div class="warning">
			<strong>Important:</strong> Only authorize applications you trust. This will give the application access to your ABsmartly account.
		</div>
		<form method="POST" action="${escapeHtml(new URL(request.url).pathname)}">
			<input type="hidden" name="state" value="${escapeHtml(encodedState)}">
			<div class="buttons">
				<button type="button" class="btn btn-secondary" onclick="window.history.back()">
					Cancel
				</button>
				<button type="submit" class="btn btn-primary">
					Authorize
				</button>
			</div>
		</form>
	</div>
</body>
</html>`;
	return new Response(html, {
		headers: {
			"Content-Type": "text/html",
		},
	});
}
