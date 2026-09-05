"use client";

export type BoardStatus = "available" | "taken" | "mine";

export function BoardStatusButtons({ status = "available", onChange, playerName }: {
  status?: BoardStatus;
  onChange: (status: BoardStatus) => void;
  playerName: string;
}) {
  const options: Array<{ value: BoardStatus; label: string }> = [
    { value: "available", label: "Available" },
    { value: "taken", label: "Taken" },
    { value: "mine", label: "My pick" },
  ];
  return <div className="board-status-buttons" role="group" aria-label={`${playerName} draft status`}>
    {options.map((option) => <button
      type="button"
      key={option.value}
      className={`${option.value} ${status === option.value ? "active" : ""}`}
      aria-pressed={status === option.value}
      onClick={() => onChange(option.value)}
    >{option.label}</button>)}
  </div>;
}
