import { useEffect, useState } from "react";
import Terminal, { ColorMode } from "@/components/Terminal";
import { client } from "@/api/client";

type Props = {
  name: string;
};

export function ContainerLogs(props: Props) {
  const { name } = props;
  const [terminalLineData, setTerminalLineData] = useState<string[]>([]);

  useEffect(() => {
    const evtSource = new EventSource(`/api/container/${name}/logs`);
    evtSource.addEventListener("message", (ev) => {
      setTerminalLineData((prev) => [...prev, ev.data]);
    });

    return () => {
      evtSource.close();
    };
  }, [name]);

  return (
    <div className="container">
      <Terminal data={terminalLineData} colorMode={ColorMode.Dark} />
    </div>
  );
}
