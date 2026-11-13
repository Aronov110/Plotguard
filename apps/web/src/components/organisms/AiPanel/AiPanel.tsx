import { type ReactElement, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  describeScope,
  formatRunTime,
  kindWord,
  statusWord,
} from "../../../lib/analyses/describe-run.ts";
import { isFocusValid } from "../../../lib/analyses/focus.ts";
import { useAnalysisPanel } from "../../../lib/analyses/use-analysis-panel.ts";
import { useElapsedSeconds } from "../../../lib/analyses/use-elapsed-seconds.ts";
import type { Analysis, AnalysisKind, AnalysisTarget } from "../../../lib/api/analyses-api.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { AiPrivacyNotice } from "../../molecules/AiPrivacyNotice/AiPrivacyNotice.tsx";
import { CostHint } from "../../molecules/CostHint/CostHint.tsx";
import { DeleteConfirmation } from "../../molecules/DeleteConfirmation/DeleteConfirmation.tsx";
import { FocusField } from "../../molecules/FocusField/FocusField.tsx";
import { ModeChoice } from "../../molecules/ModeChoice/ModeChoice.tsx";
import { Notice } from "../../molecules/Notice/Notice.tsx";
import { ScopeChoice, type ScopeValue } from "../../molecules/ScopeChoice/ScopeChoice.tsx";
import { AnalysisResult } from "../AnalysisResult/AnalysisResult.tsx";
import "./AiPanel.css";

export interface AiPanelProps {
  readonly projectId: string;
  /** The item that is open on the writing screen, if any. */
  readonly openItem: { readonly id: string; readonly title: string } | undefined;
  /** The title of every item in the outline, by id: links and names in results use it. */
  readonly titles: ReadonlyMap<string, string>;
  /** Called when a link to an item is pressed: the screen moves the focus into its text. */
  readonly onOpenItem: (id: string) => void;
}

/** The words on the buttons and in the progress, for each kind of run. */
const WORDS: Readonly<
  Record<
    AnalysisKind,
    {
      readonly run: string;
      readonly busy: string;
      readonly cancel: string;
      readonly progress: string;
      readonly trouble: string;
      /** In the name of a history button: "Open the scan of …", "Open the ideas for …". */
      readonly of: string;
      readonly noun: string;
      readonly lost: string;
    }
  >
> = {
  plot_holes: {
    run: "Run the scan",
    busy: "Scanning…",
    cancel: "Cancel the scan",
    progress: "The scan is running",
    trouble: "Having trouble checking on the scan. Still trying; the scan itself keeps going.",
    of: "scan of",
    noun: "scan",
    lost: "Its findings are lost for good. This cannot be undone.",
  },
  ideas: {
    run: "Get ideas",
    busy: "Thinking of ideas…",
    cancel: "Cancel the request",
    progress: "The idea request is running",
    trouble:
      "Having trouble checking on the idea request. Still trying; the request itself keeps going.",
    of: "ideas for",
    noun: "ideas",
    lost: "The ideas and the focus are lost for good. This cannot be undone.",
  },
};

/** Shows how long a run has been going. The text is not a live region, so it is not read out. */
function Progress({ analysis, trouble }: { analysis: Analysis; trouble: boolean }): ReactElement {
  const seconds = useElapsedSeconds(analysis.createdAt, true);
  const words = WORDS[analysis.kind];
  return (
    <div className="ai-panel__progress">
      <progress aria-label={words.progress} />
      <p>
        Reading your text…{seconds === undefined ? "" : ` ${seconds} s.`} This usually takes a
        minute or two, and longer for a long project. You can keep writing.
      </p>
      {trouble ? <p>{words.trouble}</p> : null}
    </div>
  );
}

/**
 * The AI assistant on the writing screen: a collapsed section that opens to a choice of what the AI
 * should do (find plot holes, or suggest ideas), what to read, the cost, the privacy notice with the
 * Run button, the progress, the result, and the earlier results. Nothing is loaded until the panel is
 * first opened. The choice is locked while a run goes, and a run found going when the page opens
 * shows its own kind, whatever was chosen.
 */
export function AiPanel({ projectId, openItem, titles, onOpenItem }: AiPanelProps): ReactElement {
  const ids = useId();
  const regionId = `${ids}-region`;
  const privacyId = `${ids}-privacy`;
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ScopeValue | undefined>(undefined);
  const [mode, setMode] = useState<AnalysisKind>("plot_holes");
  const [focus, setFocus] = useState("");
  const [confirming, setConfirming] = useState<string | undefined>(undefined);

  // Reading the open item is the natural choice while one is open; the writer's own pick wins.
  // An item cannot be read when none is open, whatever was chosen before it was closed.
  const wanted: ScopeValue = choice ?? "item";
  const scope: ScopeValue = wanted === "item" && openItem !== undefined ? "item" : "project";
  const openItemId = openItem?.id;
  const target = useMemo<AnalysisTarget>(
    () =>
      scope === "item" && openItemId !== undefined
        ? { scope: "document", documentId: openItemId }
        : { scope: "project" },
    [scope, openItemId],
  );

  const panel = useAnalysisPanel({ projectId, target, enabled: open, kind: mode, focus });
  const { run, estimate, history, problem } = panel;
  const busy = run.phase === "starting" || run.phase === "running";
  // A run that is going (perhaps found again after a reload) decides what the panel shows.
  const kind: AnalysisKind = run.phase === "running" ? run.analysis.kind : mode;
  const words = WORDS[kind];
  const unavailable =
    problem?.kind === "unavailable" ||
    (estimate.status === "ready" && !estimate.estimate.available);
  const tooLong = estimate.status === "ready" && !estimate.estimate.fits;
  const focusTooLong = kind === "ideas" && !isFocusValid(focus);

  // After an earlier run is opened from the history, the focus goes to its result.
  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusResult = useRef(false);
  const historyHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (focusResult.current && run.phase === "finished") {
      focusResult.current = false;
      resultHeadingRef.current?.focus();
    }
  }, [run]);

  useEffect(() => {
    if (confirming !== undefined) keepRef.current?.focus();
  }, [confirming]);

  const openFromHistory = (analysis: Analysis): void => {
    focusResult.current = true;
    panel.openRun(analysis);
  };

  const confirmDelete = (analysis: Analysis): void => {
    setConfirming(undefined);
    historyHeadingRef.current?.focus();
    panel.removeRun(analysis);
  };

  const announcement = panel.announcement;

  return (
    <section className="ai-panel" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`} className="ai-panel__heading">
        <button
          type="button"
          className="ai-panel__toggle"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => {
            setOpen((previous) => !previous);
          }}
        >
          <span>AI assistant</span>
          <span aria-hidden="true">{open ? "Hide" : "Show"}</span>
        </button>
      </h2>

      <div id={regionId} hidden={!open} className="ai-panel__body">
        <p className="ai-panel__intro">
          An AI reads your story. It can point out places where the story contradicts itself or
          leaves something unexplained, or suggest ideas for where it could go next.
        </p>

        {unavailable ? (
          <Notice tone="info">
            {problem?.kind === "unavailable"
              ? problem.message
              : "The AI features are not switched on on this server."}
          </Notice>
        ) : (
          <>
            <ModeChoice value={kind} onChange={setMode} disabled={busy} />
            <ScopeChoice
              value={scope}
              onChange={setChoice}
              itemTitle={openItem?.title}
              disabled={busy}
            />
            {kind === "ideas" ? (
              <FocusField id={`${ids}-focus`} value={focus} onChange={setFocus} disabled={busy} />
            ) : null}
            <CostHint view={estimate} onRetry={panel.retryEstimate} />
            <AiPrivacyNotice id={privacyId} kind={kind} />
            <div className="ai-panel__buttons">
              <Button
                busy={busy}
                disabled={tooLong || focusTooLong}
                onClick={panel.start}
                aria-describedby={privacyId}
              >
                {busy ? words.busy : words.run}
              </Button>
              {run.phase === "running" ? (
                <Button variant="secondary" busy={run.cancelling} onClick={panel.cancel}>
                  {run.cancelling ? "Cancelling…" : words.cancel}
                </Button>
              ) : null}
            </div>
          </>
        )}

        {problem !== undefined && problem.kind === "problem" ? (
          <div role="alert" className="ai-panel__problem">
            <p>{problem.message}</p>
            <Button variant="secondary" onClick={panel.dismissProblem}>
              Close this message
            </Button>
          </div>
        ) : null}

        {run.phase === "running" ? (
          <Progress analysis={run.analysis} trouble={run.trouble} />
        ) : null}

        {run.phase === "finished" ? (
          <AnalysisResult
            analysis={run.analysis}
            titles={titles}
            headingRef={resultHeadingRef}
            onClose={panel.dismiss}
            onOpenItem={onOpenItem}
          />
        ) : null}

        <section className="ai-panel__history" aria-labelledby={`${ids}-history`}>
          <h3 id={`${ids}-history`} tabIndex={-1} ref={historyHeadingRef}>
            Earlier results
          </h3>
          {history.status === "loading" ? <p role="status">Loading your earlier results…</p> : null}
          {history.status === "failed" ? (
            <div className="ai-panel__problem">
              <p>{history.message}</p>
              <Button variant="secondary" onClick={panel.retryHistory}>
                Try again
              </Button>
            </div>
          ) : null}
          {history.status === "ready" && history.items.length === 0 ? (
            <p className="ai-panel__empty">No earlier results.</p>
          ) : null}
          {history.status === "ready" && history.items.length > 0 ? (
            <>
              <ul className="ai-panel__runs">
                {history.items.map((analysis) => {
                  const when = formatRunTime(analysis.createdAt) ?? "an unknown time";
                  const what = describeScope(analysis, titles);
                  const label = `${what}, ${when}`;
                  const rowWords = WORDS[analysis.kind];
                  return (
                    <li key={analysis.id} className="ai-panel__run">
                      <p className="ai-panel__run-text">
                        {when}: {kindWord(analysis.kind)}, {what}, {statusWord(analysis)}
                      </p>
                      <div className="ai-panel__run-buttons">
                        <Button
                          variant="secondary"
                          aria-label={`${analysis.status === "pending" ? "Watch" : "Open"} the ${rowWords.of} ${label}`}
                          onClick={() => {
                            openFromHistory(analysis);
                          }}
                        >
                          {analysis.status === "pending" ? "Watch" : "Open"}
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label={`Delete the ${rowWords.of} ${label}`}
                          onClick={() => {
                            setConfirming(analysis.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                      {confirming === analysis.id ? (
                        <DeleteConfirmation
                          title={`${rowWords.of} ${label}`}
                          noun={rowWords.noun}
                          consequence={rowWords.lost}
                          busy={false}
                          error={undefined}
                          keepRef={keepRef}
                          onConfirm={() => {
                            confirmDelete(analysis);
                          }}
                          onCancel={() => {
                            setConfirming(undefined);
                          }}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {history.nextCursor === null ? null : (
                <Button variant="secondary" busy={history.loadingMore} onClick={panel.loadMore}>
                  {history.loadingMore ? "Loading…" : "Show older results"}
                </Button>
              )}
            </>
          ) : null}
        </section>
      </div>

      {/* Always in the page, so that a screen reader is already listening when its text changes. */}
      <p role="status" className="visually-hidden">
        {announcement.text === ""
          ? ""
          : announcement.text + (announcement.serial % 2 === 0 ? " " : "")}
      </p>
    </section>
  );
}
