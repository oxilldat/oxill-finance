/** Native date field following the interaction used by Oxill Forms. */
export class InteractiveDatePicker {
  private readonly inputHandler = (): void => {
    this.onChange(this.input.value);
  };

  constructor(
    private readonly input: HTMLInputElement,
    value: string,
    includeTime: boolean,
    private readonly onChange: (value: string) => void,
  ) {
    this.input.type = includeTime ? "datetime-local" : "date";
    this.input.value = normalizeValue(value, includeTime);
    this.input.addClass("oxf-date-picker-input");
    if (includeTime) {
      this.input.step = "60";
    }
    this.input.addEventListener("input", this.inputHandler);
  }

  destroy(): void {
    this.input.removeEventListener("input", this.inputHandler);
  }
}

function normalizeValue(value: string, includeTime: boolean): string {
  if (includeTime) {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
    return match ? `${match[1]}T${match[2]}` : "";
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? "";
}
