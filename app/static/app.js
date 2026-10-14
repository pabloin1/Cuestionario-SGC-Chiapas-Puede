const intro = document.querySelector("#intro");
const quiz = document.querySelector("#quiz");
const complete = document.querySelector("#complete");
const form = document.querySelector("#participant-form");
const nameInput = document.querySelector("#participant-name");
const sectionLabel = document.querySelector("#section-label");
const progressLabel = document.querySelector("#progress-label");
const progressBar = document.querySelector(".progress-track");
const progressFill = document.querySelector("#progress-fill");
const questionTitle = document.querySelector("#question-title");
const optionsNode = document.querySelector("#answer-options");
const previousButton = document.querySelector("#previous-button");
const nextButton = document.querySelector("#next-button");
const submitButton = document.querySelector("#submit-button");
const answeredLabel = document.querySelector("#answered-label");
const quizError = document.querySelector("#quiz-error");
const loadError = document.querySelector("#load-error");
const questions = [];
const answers = new Map();
let participantName = "";
let currentIndex = 0;

async function loadQuestions() {
  try {
    const response = await fetch("/api/questions");
    if (!response.ok) throw new Error("No fue posible cargar el cuestionario.");
    questions.push(...await response.json());
  } catch (error) {
    loadError.textContent = error.message;
    loadError.hidden = false;
    form.querySelector("button").disabled = true;
  }
}

function renderQuestion() {
  const question = questions[currentIndex];
  if (!question) return;
  sectionLabel.textContent = question.section;
  progressLabel.textContent = `Pregunta ${currentIndex + 1} de ${questions.length}`;
  progressFill.style.width = `${(currentIndex / questions.length) * 100}%`;
  progressBar.setAttribute("aria-valuenow", String(currentIndex));
  questionTitle.textContent = question.question;
  const legend = optionsNode.querySelector("legend");
  optionsNode.replaceChildren(legend);
  question.options.forEach((option, optionIndex) => {
    const label = document.createElement("label");
    label.className = "answer-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `question-${question.id}`;
    input.value = String(optionIndex);
    input.checked = answers.get(question.id) === optionIndex;
    input.addEventListener("change", () => {
      answers.set(question.id, optionIndex);
      updateControls();
    });
    const text = document.createElement("span");
    text.textContent = option;
    label.append(input, text);
    optionsNode.append(label);
  });
  updateControls();
}

function updateControls() {
  const selected = answers.has(questions[currentIndex]?.id);
  previousButton.disabled = currentIndex === 0;
  nextButton.hidden = currentIndex === questions.length - 1;
  submitButton.hidden = currentIndex !== questions.length - 1;
  nextButton.disabled = !selected;
  submitButton.disabled = answers.size !== questions.length;
  answeredLabel.textContent = `${answers.size} de ${questions.length} respondidas`;
  quizError.hidden = true;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity() || !questions.length) return;
  participantName = nameInput.value.trim();
  if (participantName.length < 2) {
    nameInput.setCustomValidity("Escribe tu nombre completo.");
    nameInput.reportValidity();
    return;
  }
  nameInput.setCustomValidity("");
  intro.hidden = true;
  quiz.hidden = false;
  renderQuestion();
  questionTitle.focus();
});

previousButton.addEventListener("click", () => {
  if (currentIndex > 0) {
    currentIndex -= 1;
    renderQuestion();
    questionTitle.focus();
  }
});
nextButton.addEventListener("click", () => {
  if (answers.has(questions[currentIndex]?.id) && currentIndex < questions.length - 1) {
    currentIndex += 1;
    renderQuestion();
    questionTitle.focus();
  }
});
submitButton.addEventListener("click", async () => {
  if (answers.size !== questions.length) {
    quizError.textContent = "Responde todas las preguntas antes de enviar.";
    quizError.hidden = false;
    return;
  }
  submitButton.disabled = true;
  submitButton.textContent = "Enviando…";
  try {
    const response = await fetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: participantName, answers: Object.fromEntries(answers) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "No fue posible guardar tus respuestas.");
    quiz.hidden = true;
    complete.hidden = false;
    document.querySelector("#result-message").textContent = `Tu resultado es ${result.score} de ${result.total} (${result.percent}%). La evaluación quedó registrada.`;
    document.querySelector("#complete-title").focus();
  } catch (error) {
    quizError.textContent = error.message;
    quizError.hidden = false;
    submitButton.disabled = false;
    submitButton.textContent = "Enviar evaluación";
  }
});

loadQuestions();
