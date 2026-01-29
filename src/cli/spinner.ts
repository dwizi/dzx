import { colorize } from "./format.js";

const frames = ["◐", "◓", "◑", "◒"];

export type Spinner = {
  start: (message: string) => void;
  update: (message: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  isEnabled: boolean;
};

/**
 * Create a terminal spinner controller.
 */
export function createSpinner(enabled: boolean): Spinner {
  let timer: NodeJS.Timeout | null = null;
  let message = "";
  let frameIndex = 0;

  /**
   * Clear the current terminal line.
   */
  const clearLine = () => {
    if (!enabled) return;
    process.stdout.write("\r\x1b[2K");
  };

  /**
   * Render the next spinner frame.
   */
  const render = () => {
    if (!enabled) return;
    const frame = frames[frameIndex % frames.length];
    frameIndex += 1;
    process.stdout.write(`\r${colorize.gray(frame)}  ${message}`);
  };

  /**
   * Start the spinner with a message.
   */
  const start = (nextMessage: string) => {
    message = nextMessage;
    if (!enabled || timer) return;
    render();
    timer = setInterval(render, 80);
  };

  /**
   * Update the spinner message.
   */
  const update = (nextMessage: string) => {
    message = nextMessage;
    if (!enabled || !timer) return;
    render();
  };

  /**
   * Pause rendering and clear the line.
   */
  const pause = () => {
    if (!enabled || !timer) return;
    clearInterval(timer);
    timer = null;
    clearLine();
  };

  /**
   * Resume rendering from the current message.
   */
  const resume = () => {
    if (!enabled || timer || !message) return;
    render();
    timer = setInterval(render, 80);
  };

  /**
   * Stop and reset spinner state.
   */
  const stop = () => {
    pause();
    message = "";
  };

  return { start, update, pause, resume, stop, isEnabled: enabled };
}
