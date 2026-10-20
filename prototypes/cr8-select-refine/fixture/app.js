window.__clicks = 0;
window.__submits = 0;
window.__pointerdowns = 0;
window.__touchstarts = 0;

document.addEventListener("pointerdown", () => window.__pointerdowns++, true);
document.addEventListener("touchstart", () => window.__touchstarts++, { capture: true, passive: true });

document.getElementById("start-trial").addEventListener("click", () => {
  window.__clicks++;
  document.getElementById("clicks").textContent = String(window.__clicks);
});

document.getElementById("spa-link").addEventListener("click", (event) => {
  event.preventDefault();
  history.pushState({}, "", "/pricing?tab=teams");
  document.querySelector("h1").textContent = "Pricing for teams";
});

const scroller = document.getElementById("scroller");
scroller.scrollTop = scroller.scrollHeight;

for (const [tag, mode] of [["payment-card-open", "open"], ["payment-card-closed", "closed"]]) {
  customElements.define(tag, class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode });
      root.innerHTML = `<style>div{padding:10px;border:1px solid #cfd5e3;border-radius:10px;background:#fff;margin:8px 0;font-size:14px}</style><div>${mode} card 4111 1111 1111 1111 · billing@example.com</div>`;
    }
  });
}
