import { beforeEach, describe, expect, it } from "vitest";

import { useUpdateStore } from "@/stores/modules/update";

const available = {
  available: true,
  version: "0.2.9",
  currentVersion: "0.2.8",
  notes: "Next release",
};
const completed = {
  previousVersion: "0.2.7",
  currentVersion: "0.2.8",
  notes: "Installed release",
};

beforeEach(() => {
  useUpdateStore.setState(useUpdateStore.getInitialState(), true);
});

const state = () => useUpdateStore.getState();

describe("update reminder preview isolation", () => {
  it("restores an unacknowledged completion after switching previews, before the next update", () => {
    state().openCompleted(completed);
    state().setFromInfo(available);
    state().openAvailable(available, true);
    state().openCompleted(completed, true);
    state().closeDialog();

    expect(state().dialog).toEqual({ kind: "completed", info: completed, preview: false });
    state().closeDialog();
    expect(state().dialog).toEqual({ kind: "available", info: available, preview: false });
  });

  it("defers a completion arriving during preview without replacing the preview or losing it to a check", () => {
    state().openAvailable(available, true);
    state().openCompleted(completed);
    expect(state().dialog?.preview).toBe(true);
    state().setFromInfo(available);
    state().set(false, "");
    state().closeDialog();

    expect(state().dialog).toEqual({ kind: "completed", info: completed, preview: false });
    state().closeDialog();
    expect(state().dialog).toBeNull();
  });

  it("shows a check result arriving during preview, but does not restore a subsequently skipped update", () => {
    state().openCompleted(completed, true);
    state().setFromInfo(available);
    expect(state().dialog?.kind).toBe("completed");
    state().closeDialog();
    expect(state().dialog).toEqual({ kind: "available", info: available, preview: false });

    state().openCompleted(completed, true);
    state().setFromInfo(available, available.version);
    state().closeDialog();
    expect(state().dialog).toBeNull();
  });

  it("keeps download progress and installation errors intact while previews open and close", () => {
    state().setProgress({ downloaded: 512, total: 1024 });
    state().setError("download interrupted");
    state().openAvailable(available, true);
    state().openCompleted(completed, true);
    state().closeDialog();

    expect(state().progress).toEqual({ downloaded: 512, total: 1024 });
    expect(state().error).toBe("download interrupted");
  });
});
