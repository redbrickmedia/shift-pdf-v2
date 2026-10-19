export interface AdjustColorsSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  hueShift: number;
  temperature: number;
  tint: number;
  gamma: number;
  sepia: number;
  greyscale?: boolean;
  invertColors?: boolean;
  backgroundColor?: string | null;
  textColor?: string | null;
  textDarknessThreshold?: number;
}
