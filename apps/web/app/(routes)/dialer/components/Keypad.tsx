"use client";

import { Button } from "@/components/ui/button";

const KEYS: Array<[string, string]> = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];

export function Keypad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map(([key, letters]) => (
        <Button
          key={key}
          type="button"
          variant="outline"
          className="h-12 flex-col gap-0"
          onClick={() => onKey(key)}
        >
          <span className="text-lg font-medium leading-none">{key}</span>
          {letters && (
            <span className="text-[9px] leading-none text-muted-foreground tracking-widest">
              {letters}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}
