const rawBase = (import.meta.env.VITE_API_BASE_URL || "").trim();

const isPlaceholderUrl = (value) => /your-api\.onrender\.com/i.test(value);

const normalizeBaseUrl = (value) => {
    if (!value) return "http://localhost:5000";
    return value.replace(/\/+$/, "");
};

export const API_BASE = normalizeBaseUrl(rawBase);
export const API_MISCONFIGURED = isPlaceholderUrl(API_BASE);

export async function parseJsonResponse(response) {
    const text = await response.text();
    let data = null;

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }

    if (!response.ok) {
        const message = data?.error || data?.message || `Request failed (${response.status})`;
        throw new Error(message);
    }

    return data;
}
