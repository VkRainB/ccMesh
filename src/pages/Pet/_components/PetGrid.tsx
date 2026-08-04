import type { PetListItem } from "@/services/modules/pet";

import { ImportTile } from "./ImportTile";
import { PetTile } from "./PetTile";

interface Props {
  pets: PetListItem[];
  selectedDirId?: string | null;
  importing?: boolean;
  onSelect: (dirId: string) => void;
  onDelete: (pet: PetListItem) => void;
  onImportFolder: () => void;
  onImportZip: () => void;
}

export function PetGrid({
  pets,
  selectedDirId,
  importing,
  onSelect,
  onDelete,
  onImportFolder,
  onImportZip,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <ImportTile
        disabled={importing}
        onImportFolder={onImportFolder}
        onImportZip={onImportZip}
      />
      {pets.map((pet) => (
        <PetTile
          key={pet.dirId}
          pet={pet}
          selected={selectedDirId === pet.dirId}
          onSelect={() => onSelect(pet.dirId)}
          onDelete={() => onDelete(pet)}
        />
      ))}
    </div>
  );
}
