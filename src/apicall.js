export async function apiRequest(kind) {

    const delays = [10000, 15000, 20000]; // in ms (10s, 15s, 20s)

    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            let value = await fetch(kind);

            if (!value.ok) {
                if (value.status === 429 && attempt < delays.length) {
                    showRetryWarning(`⚠️ Too many requests. Retrying in ${delays[attempt]/1000}s...`);
                    
                    await new Promise(res => setTimeout(res, delays[attempt]));
                    continue;
                }

                if (value.status === 500) {
                    alert("🚨 Server Error (500). Please try again later.");
                } else if (value.status === 429) {
                    alert("⚠️ Too many requests. Tried multiple times, please try later.");
                } else {
                    alert(`❌ Error ${value.status}: ${value.statusText}`);
                }

                return null;
            }

            let data = await value.json();
            return data;

        } catch (error) {

            if (error.name === "AbortError") {
                console.log("Request was aborted.");
            } else if (error instanceof TypeError && error.message === "Failed to fetch") {
                alert("Failed to reach server.");
            } else {
                alert(`❗ Unexpected error: ${error.message}`);
            }

            console.log(error);
            return null;
        }
    }
}

function showRetryWarning(message, duration = 3000) {
    const div = document.createElement("div");
    div.textContent = message;

    Object.assign(div.style, {
        position: "fixed",
        top: "20px",
        right: "20px",
        padding: "12px 18px",
        background: "#ff9800",
        color: "#fff",
        borderRadius: "8px",
        fontSize: "14px",
        zIndex: 1000,
        boxShadow: "0 4px 10px rgba(0,0,0,0.2)"
    });

    document.body.appendChild(div);

    setTimeout(() => {
        div.remove();
    }, duration);
}