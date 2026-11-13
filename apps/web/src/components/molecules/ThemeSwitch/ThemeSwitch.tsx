import type { ReactElement } from "react";
import type { ThemePreference } from "../../../lib/theme/theme.ts";
import { useTheme } from "../../../lib/theme/use-theme.ts";
import { SegmentedControl, type SegmentedOption } from "../SegmentedControl/SegmentedControl.tsx";
import "./ThemeSwitch.css";

const OPTIONS: readonly SegmentedOption<ThemePreference>[] = [
  { value: "system", label: "System", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

/**
 * Chooses the colour theme: follow the system, or always light, or always dark. The choice is saved
 * in the browser and put on the page at once. On a narrow screen the words are left to screen
 * readers and the pictures show alone, to save room.
 */
export function ThemeSwitch(): ReactElement {
  const { preference, setPreference } = useTheme();
  return (
    <div className="theme-switch">
      <SegmentedControl
        legend="Colour theme"
        hideLegend
        options={OPTIONS}
        value={preference}
        onChange={setPreference}
      />
    </div>
  );
}
