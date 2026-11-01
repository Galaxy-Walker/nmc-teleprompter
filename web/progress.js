// Keep animation smooth while avoiding writes for unchanged rounded values.
// Compare against the DOM so user-driven slider changes are also reconciled.
export function renderProgress(hud, slider, detail, charsRead, total) {
  const ratio = total > 0 ? charsRead / total : 0;
  const percent = Math.round(ratio * 100);
  const label = `${percent}%`;
  const position = String(Math.round(ratio * 1000));
  const description = `${percent}% · ${Math.round(charsRead)}/${total}`;

  if (hud.textContent !== label) hud.textContent = label;
  if (slider.value !== position) slider.value = position;
  if (detail.textContent !== description) detail.textContent = description;
}
