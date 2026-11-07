import net from "node:net";

export type SilentServer = {
  /** A connection string that points at the server. */
  url: () => string;
  close: () => Promise<void>;
};

/** A server that accepts a connection and then never says a word: a database that is waking up, or unreachable. */
export async function startSilentServer(): Promise<SilentServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: () => `postgresql://svc_probe_x9:pw_Zq81Lm@127.0.0.1:${port}/db_zz_probe`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The address of a port that nothing listens on, so a connection is refused at once. */
export async function closedPortUrl(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `postgresql://svc_probe_x9:pw_Zq81Lm@127.0.0.1:${port}/db_zz_probe`;
}
