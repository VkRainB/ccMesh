import { UpdateProgressCard } from "./components/business";
import { UpdateDialogs } from "./components/business/UpdateDialogs";
import { CloseDialog } from "./components/common";
import { useAutoTheme } from "./hooks/useAutoTheme";
import { useThemeSync } from "./hooks/useThemeSync";
import { useTrayActions } from "./hooks/useTrayActions";
import { useUpdate } from "./hooks/useUpdate";
import { AppLayout } from "./layouts/AppLayout";

function App() {
  useThemeSync();
  useAutoTheme();
  useTrayActions();
  useUpdate();

  return (
    <>
      <AppLayout />
      <CloseDialog />
      <UpdateProgressCard />
      <UpdateDialogs />
    </>
  );
}

export default App;
