import type { ReactElement, Ref } from "react";
import { describeRunFailure } from "../../../lib/analyses/analysis-feedback.ts";
import { countFindings, describeScope, formatRunTime } from "../../../lib/analyses/describe-run.ts";
import { describeSize } from "../../../lib/analyses/format-cost.ts";
import type { Analysis } from "../../../lib/api/analyses-api.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { FindingCard } from "../../molecules/FindingCard/FindingCard.tsx";
import "./AnalysisResult.css";

export interface AnalysisResultProps {
  /** A run that has ended: it succeeded or it failed. */
  readonly analysis: Analysis;
  readonly titles: ReadonlyMap<string, string>;
  /** Attach to the heading: the panel moves the focus there when a writer opens an earlier run. */
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly onClose: () => void;
  /** Called with the id of an item when a finding's link to it is pressed. */
  readonly onOpenItem: (id: string) => void;
}

/**
 * What a finished scan found, or why it did not finish. A scan that found nothing says so plainly
 * and reminds the writer that an AI can miss things, as it can be wrong about what it does find.
 */
export function AnalysisResult({
  analysis,
  titles,
  headingRef,
  onClose,
  onOpenItem,
}: AnalysisResultProps): ReactElement {
  const when = formatRunTime(analysis.createdAt);
  const scope = describeScope(analysis, titles);
  const { result } = analysis;

  return (
    <section className="analysis-result" aria-labelledby="analysis-result-heading">
      <div className="analysis-result__top">
        <h3 id="analysis-result-heading" tabIndex={-1} ref={headingRef}>
          Scan of {scope}
          {when === undefined ? "" : `, ${when}`}
        </h3>
        <Button variant="secondary" onClick={onClose}>
          Close this result
        </Button>
      </div>

      {analysis.status === "succeeded" && result !== null ? (
        <>
          <p className="analysis-result__summary">{result.summary}</p>
          <p className="analysis-result__facts">
            {describeSize(result.read.characters)} {countFindings(result.findings)}
          </p>
          {result.findings.length === 0 ? (
            <p>
              No plot holes were found. The AI can miss things, so this is not a promise that the
              story is sound.
            </p>
          ) : (
            <>
              <p className="analysis-result__caution">
                The AI can be wrong. Check each finding against your own text.
              </p>
              <ol className="analysis-result__findings" aria-label="Findings">
                {result.findings.map((finding, index) => (
                  <FindingCard
                    // biome-ignore lint/suspicious/noArrayIndexKey: the findings never change after they are shown, and two may share a title
                    key={`${index}-${finding.title}`}
                    finding={finding}
                    titles={titles}
                    onOpenItem={onOpenItem}
                  />
                ))}
              </ol>
            </>
          )}
        </>
      ) : (
        <p className="analysis-result__failure">{describeRunFailure(analysis.errorCode).message}</p>
      )}
    </section>
  );
}
