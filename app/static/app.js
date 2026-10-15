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
const pendingMatches = new Map();
const pendingOrders = new Map();
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

function isAnswered(question) {
  const value = answers.get(question.id);
  if (question.type === "multiple_choice" || question.type === "true_false") return Number.isInteger(value);
  if (question.type === "multiple_select") return Array.isArray(value) && value.length > 0;
  if (question.type === "matching") return Array.isArray(value) && value.length === question.left_items.length && value.every(Number.isInteger);
  if (question.type === "ordering") return Array.isArray(value) && value.length === question.items.length;
  return false;
}
function answeredCount() { return questions.filter(isAnswered).length; }
function renderQuestion() {
  const question = questions[currentIndex];
  if (!question) return;
  sectionLabel.textContent = question.section;
  progressLabel.textContent = `Pregunta ${currentIndex + 1} de ${questions.length}`;
  progressFill.style.width = `${(currentIndex / questions.length) * 100}%`;
  progressBar.setAttribute("aria-valuemax", String(questions.length));
  progressBar.setAttribute("aria-valuenow", String(currentIndex));
  questionTitle.textContent = question.question;
  const statement = document.querySelector("#question-statement");
  statement.textContent = question.statement || "";
  statement.hidden = !question.statement;
  const instruction = document.querySelector("#question-instruction");
  instruction.textContent = question.type === "multiple_select" ? "Selecciona todas las opciones correctas." : question.type === "matching" ? "Elige una correspondencia para cada elemento." : question.type === "ordering" ? "Usa los controles para ordenar los pasos y confirma tu respuesta." : "Selecciona una respuesta.";
  const legend = optionsNode.querySelector("legend");
  optionsNode.replaceChildren(legend);
  if (question.type === "matching") {
    renderMatching(question);
  } else if (question.type === "ordering") {
    renderOrdering(question);
  } else {
    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label"); label.className = "answer-choice";
      const input = document.createElement("input");
      input.type = question.type === "multiple_select" ? "checkbox" : "radio";
      input.name = `question-${question.id}`; input.value = String(optionIndex);
      const saved = answers.get(question.id);
      input.checked = question.type === "multiple_select" ? Array.isArray(saved) && saved.includes(optionIndex) : saved === optionIndex;
      input.addEventListener("change", () => {
        if (question.type === "multiple_select") {
          const selected = new Set(answers.get(question.id) || []);
          if (input.checked) selected.add(optionIndex); else selected.delete(optionIndex);
          if (selected.size) answers.set(question.id, [...selected].sort((a, b) => a - b)); else answers.delete(question.id);
        } else answers.set(question.id, optionIndex);
        updateControls();
      });
      const text = document.createElement("span"); text.textContent = option;
      label.append(input, text); optionsNode.append(label);
    });
  }
  updateControls();
}
function renderMatching(question) {
  const legend = optionsNode.querySelector("legend"); optionsNode.replaceChildren(legend);
  const saved = answers.get(question.id) || pendingMatches.get(question.id) || [];
  question.left_items.forEach((item, itemIndex) => {
    const row = document.createElement("div"); row.className = "matching-row";
    const label = document.createElement("label"); label.htmlFor = `match-${question.id}-${itemIndex}`; label.textContent = item;
    const select = document.createElement("select"); select.id = label.htmlFor; select.setAttribute("aria-label", `Relacionar ${item}`);
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Selecciona una opci\u00f3n"; select.append(placeholder);
    question.right_options.forEach((option, optionIndex) => {
      const node = document.createElement("option"); node.value = String(optionIndex); node.textContent = option;
      node.selected = saved[itemIndex] === optionIndex;
      if (saved.includes(optionIndex) && saved[itemIndex] !== optionIndex) node.disabled = true;
      select.append(node);
    });
    select.addEventListener("change", () => {
      const values = [...optionsNode.querySelectorAll(".matching-row select")].map((node) => node.value === "" ? null : Number(node.value));
      pendingMatches.set(question.id, values);
      if (values.every(Number.isInteger) && new Set(values).size === values.length) answers.set(question.id, values); else answers.delete(question.id);
      renderMatching(question);
      updateControls();
    });
    row.append(label, select); optionsNode.append(row);
  });
}
function renderOrdering(question) {
  const legend = optionsNode.querySelector("legend"); optionsNode.replaceChildren(legend);
  const saved = answers.get(question.id) || pendingOrders.get(question.id);
  const order = saved ? [...saved] : question.items.map((_, index) => index);
  const list = document.createElement("ol"); list.className = "ordering-list";
  order.forEach((itemIndex, position) => {
    const row = document.createElement("li"); row.className = "ordering-row";
    const text = document.createElement("span"); text.textContent = question.items[itemIndex];
    const controls = document.createElement("span"); controls.className = "order-controls";
    [[-1, "Mover arriba"], [1, "Mover abajo"]].forEach(([delta, labelText]) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "icon-button order-button";
      button.textContent = delta < 0 ? "\u2191" : "\u2193"; button.setAttribute("aria-label", `${labelText}: ${question.items[itemIndex]}`);
      button.disabled = position + delta < 0 || position + delta >= order.length;
      button.addEventListener("click", () => {
        const next = position + delta; [order[position], order[next]] = [order[next], order[position]];
        pendingOrders.set(question.id, order); answers.delete(question.id); renderOrdering(question); updateControls();
      });
      controls.append(button);
    });
    row.append(text, controls); list.append(row);
  });
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "button button-secondary order-confirm"; confirm.textContent = "Confirmar este orden";
  confirm.addEventListener("click", () => { pendingOrders.set(question.id, order); answers.set(question.id, order); updateControls(); });
  optionsNode.append(list, confirm);
}
function updateControls() {
  const question = questions[currentIndex];
  const selected = question && isAnswered(question);
  const count = answeredCount();
  previousButton.disabled = currentIndex === 0;
  nextButton.hidden = currentIndex === questions.length - 1;
  submitButton.hidden = currentIndex !== questions.length - 1;
  nextButton.disabled = !selected;
  submitButton.disabled = count !== questions.length;
  answeredLabel.textContent = `${count} de ${questions.length} respondidas`;
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
  if (answeredCount() !== questions.length) {
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
