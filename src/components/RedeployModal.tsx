import {
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import Terminal from "./Terminal";
import { client } from "@/api/client";
import { parseStream } from "@adeyahya/bigbox";

export interface ImperativeAPI {
  start: () => void;
}

export type Props = {
  name: string;
};

export const RedeployModal = forwardRef<ImperativeAPI, Props>((props, ref) => {
  const { name } = props;
  const [isLoading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<string[]>([]);

  const run = useCallback(async () => {
    if (!dialogRef.current) return;
    try {
      dialogRef.current.showModal();
      setLoading(true);
      setData((data) => [...data, `Deploying ${name} 🚀`]);
      const res = await client.api.container[":name"].redeploy.$post({
        param: { name },
      });
      await parseStream(res, (val) => {
        setData((data) => [...data, val]);
      });
    } catch (error) {
      if (error instanceof Error) {
        setData((data) => [...data, error.message]);
      }
    } finally {
      setData((data) => [...data, `Deployment ${name} Done 🚀`]);
      setLoading(false);
    }
  }, [name]);

  useImperativeHandle(
    ref,
    () => {
      return {
        start: run,
      };
    },
    []
  );

  const handleClose = (e: React.SyntheticEvent<HTMLDialogElement, Event>) => {
    if (isLoading) {
      e.preventDefault();
      e.stopPropagation();
    } else {
      setData([]);
    }
  };

  return (
    <div>
      <dialog
        ref={dialogRef}
        onClose={handleClose}
        onCancel={handleClose}
        className="modal"
      >
        <div className="modal-box p-1 max-w-screen-md">
          <Terminal className="rounded-xl overflow-hidden" data={data} />
        </div>
      </dialog>
    </div>
  );
});
