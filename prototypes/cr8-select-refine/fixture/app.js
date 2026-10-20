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
