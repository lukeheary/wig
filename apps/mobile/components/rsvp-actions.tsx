import { StyleSheet, View } from "react-native";
import { Button } from "./ui";

export function RSVPActionBar({
  currentStatus,
  onSetStatus,
  loading,
}: {
  currentStatus?: string | null;
  onSetStatus: (status: "going" | "interested") => void;
  loading?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Button
        variant={currentStatus === "going" ? "primary" : "secondary"}
        onPress={() => onSetStatus("going")}
        loading={loading}
      >
        Going
      </Button>
      <Button
        variant={currentStatus === "interested" ? "primary" : "secondary"}
        onPress={() => onSetStatus("interested")}
        loading={loading}
      >
        Interested
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 12,
  },
});
