import { Button } from "./button";

export type BlockErrorProps = {
  /** What went wrong, in words: "We could not load your bills." */
  message: string;
  /** What the person cannot do because of it: "You can't pay right now." */
  consequence?: string;
  onRetry: () => void;
};

/** An error that takes the place of one block, not the whole screen, with a way to try again. */
export function BlockError({ message, consequence, onRetry }: BlockErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-control border-2 border-caution p-4">
      <p className="text-body font-semibold text-caution">{message}</p>
      {consequence !== undefined && <p className="text-body">{consequence}</p>}
      <Button variant="outlined" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
