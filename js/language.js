function applyLanguage(lang) {
  const nextLang = lang === "en" ? "en" : "ko";

  document.body.dataset.lang = nextLang;
  document.documentElement.lang = nextLang;

  localStorage.setItem("siteLanguage", nextLang);

  document.querySelectorAll("[data-set-lang]").forEach((button) => {
    button.classList.toggle("active", button.dataset.setLang === nextLang);
  });

  window.dispatchEvent(new CustomEvent("languagechange", {
    detail: { lang: nextLang }
  }));
}

function setupLanguageToggle() {
  const savedLang = localStorage.getItem("siteLanguage") || "ko";

  applyLanguage(savedLang);

  document.querySelectorAll("[data-set-lang]").forEach((button) => {
    button.addEventListener("click", () => {
      applyLanguage(button.dataset.setLang);
    });
  });
}

document.addEventListener("DOMContentLoaded", setupLanguageToggle);
