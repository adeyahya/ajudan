import { Fragment } from "react";
import Ansi from "ansi-to-react";

const TerminalOutput = ({ children }: { children?: string }) => {
  return (
    <div className="react-terminal-line whitespace-break-spaces my-0.5 opacity-70 text-[0.6rem]">
      {Array.isArray(children) ? (
        children.map((child, idx) => (
          <Fragment key={idx}>
            <Ansi>{child}</Ansi>
          </Fragment>
        ))
      ) : (
        <Ansi>{children ?? ""}</Ansi>
      )}
    </div>
  );
};

export default TerminalOutput;
