import {Request, Response} from "express";

export function makeEvent(req: Request, res: Response) {
    let ackCalled = false;
    const event = {
        body: req.body,
        ack: async (response: any) => {
            if (ackCalled) {
                return;
            }

            if (response instanceof Error) {
                res.status(500).send();
            } else if (!response) {
                res.send('')
            } else {
                res.send(response);
            }

            ackCalled = true;
        }
    };

    return event;
}