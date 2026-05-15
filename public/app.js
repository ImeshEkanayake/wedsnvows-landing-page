const form = document.querySelector("#feedback-form");
const status = document.querySelector("#form-status");
const submitButton = form.querySelector("button[type='submit']");

function setErrors(errors = {}) {
  form.querySelectorAll("[data-error-for]").forEach((node) => {
    const field = node.dataset.errorFor;
    node.textContent = errors[field] || "";
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setErrors();
  status.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "Sending...";

  const payload = Object.fromEntries(new FormData(form).entries());

  try {
    const response = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) {
      setErrors(data.errors || {});
      status.textContent = data.error || "Please check the highlighted fields.";
      return;
    }

    form.reset();
    status.textContent = "Thank you. Your suggestion has been saved.";
  } catch {
    status.textContent = "We could not send that just now. Please try again.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Send suggestion";
  }
});
