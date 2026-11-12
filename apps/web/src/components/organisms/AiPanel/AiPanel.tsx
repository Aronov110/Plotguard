import { type ReactElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { describeScope, formatRunTime, statusWord } from "../../../lib/analyses/describe-run.ts";
import { useAnalysisPanel } from "../../../lib/analyses/use-analysis-panel.ts";
import { useElapsedSeconds } from "../../../lib/analyses/use-elapsed-seconds.ts";
import type { Analysis, AnalysisTarget } from "../../../lib/api/analyses-api.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { AiPrivacyNotice } from "../../molecules/AiPrivacyNotice/AiPrivacyNotice.tsx";
import { CostHint } from "../../molecules/CostHint/CostHint.tsx";
import { DeleteConfirmation } from "../../molecules/DeleteConfirmation/DeleteConfirmation.tsx";
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
}

/** Shows how long a scan has been running. The text is not a live region, so it is not read out. */
function Progress({ analysis, trouble }: { analysis: Analysis; trouble: boolean }): ReactElement {
  const seconds = useElapsedSeconds(analysis.createdAt, true);
  return (
    <div className="ai-panel__progress">
      <progress aria-label="The scan is running" />
      <p>
        Reading your text…{seconds === undefined ? "" : ` ${seconds} s.`} This usually takes a
        minute or two, and longer for a long project. You can keep writing.
      </p>
      {trouble ? (
        <p>Having trouble checking on the scan. Still trying; the scan itself keeps going.</p>
      ) : null}
    </div>
  );
}

/**
 * The AI plot-hole finder on the writing screen: a collapsed section that opens to a choice of what
 * to read, the cost, the privacy notice with the Run button, the progress, the result, and the
 * earlier scans. Nothing is loaded until the panel is first opened.
 */
export function AiPanel({ projectId, openItem, titles }: AiPanelProps): ReactElement {
  const ids = useId();
  const regionId = `${ids}-region`;
  const privacyId = `${ids}-privacy`;
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ScopeValue | undefined>(undefined);
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

  const panel = useAnalysisPanel({ projectId, target, enabled: open });
  const { run, estimate, history, problem } = panel;
  const busy = run.phase === "starting" || run.phase === "running";
  const unavailable =
    problem?.kind === "unavailable" ||
    (estimate.status === "ready" && !estimate.estimate.available);
  const tooLong = estimate.status === "ready" && !estimate.estimate.fits;

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
          <span>Plot-hole finder</span>
          <span aria-hidden="true">{open ? "Hide" : "Show"}</span>
        </button>
      </h2>

      <div id={regionId} hidden={!open} className="ai-panel__body">
        <p className="ai-panel__intro">
          An AI reads your story and points out places where it contradicts itself or leaves
          something unexplained.
        </p>

        {unavailable ? (
          <Notice tone="info">
            {problem?.kind === "unavailable"
              ? problem.message
              : "The AI scan is not switched on on this server."}
          </Notice>
        ) : (
          <>
            <ScopeChoice
              value={scope}
              onChange={setChoice}
              itemTitle={openItem?.title}
              disabled={busy}
            />
            <CostHint view={estimate} onRetry={panel.retryEstimate} />
            <AiPrivacyNotice id={privacyId} />
            <div className="ai-panel__buttons">
              <Button
                busy={busy}
                disabled={tooLong}
                onClick={panel.start}
                aria-describedby={privacyId}
              >
                {busy ? "Scanning…" : "Run the scan"}
              </Button>
              {run.phase === "running" ? (
                <Button variant="secondary" busy={run.cancelling} onClick={panel.cancel}>
                  {run.cancelling ? "Cancelling…" : "Cancel the scan"}
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
          />
        ) : null}

        <section className="ai-panel__history" aria-labelledby={`${ids}-history`}>
          <h3 id={`${ids}-history`} tabIndex={-1} ref={historyHeadingRef}>
            Earlier scans
          </h3>
          {history.status === "loading" ? <p role="status">Loading your earlier scans…</p> : null}
          {history.status === "failed" ? (
            <div className="ai-panel__problem">
              <p>{history.message}</p>
              <Button variant="secondary" onClick={panel.retryHistory}>
                Try again
              </Button>
            </div>
          ) : null}
          {history.status === "ready" && history.items.length === 0 ? (
            <p className="ai-panel__empty">No earlier scans.</p>
          ) : null}
          {history.status === "ready" && history.items.length > 0 ? (
            <>
              <ul className="ai-panel__runs">
                {history.items.map((analysis) => {
                  const when = formatRunTime(analysis.createdAt) ?? "an unknown time";
                  const what = describeScope(analysis, titles);
                  const label = `${what}, ${when}`;
                  return (
                    <li key={analysis.id} className="ai-panel__run">
                      <p className="ai-panel__run-text">
                        {when}: {what}, {statusWord(analysis)}
                      </p>
                      <div className="ai-panel__run-buttons">
                        <Button
                          variant="secondary"
                          aria-label={`${analysis.status === "pending" ? "Watch" : "Open"} the scan of ${label}`}
                          onClick={() => {
                            openFromHistory(analysis);
                          }}
                        >
                          {analysis.status === "pending" ? "Watch" : "Open"}
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label={`Delete the scan of ${label}`}
                          onClick={() => {
                            setConfirming(analysis.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                      {confirming === analysis.id ? (
                        <DeleteConfirmation
                          title={`scan of ${label}`}
                          noun="scan"
                          consequence="Its findings are lost for good. This cannot be undone."
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
                  {history.loadingMore ? "Loading…" : "Show older scans"}
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
          : announcement.text + (announcement.serial % 2 === 0 ? " " : "")}
      </p>
    </section>
  );
}
