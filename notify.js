import notifier from "node-notifier";
import path from "path";

export function notify(title, message) {
  notifier.notify({
    title: `Storage Manager: ${title}`,
    message,
    sound: true,
    wait: false,
  });
}
