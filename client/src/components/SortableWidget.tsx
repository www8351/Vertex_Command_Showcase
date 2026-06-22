import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { WidgetId } from "@/hooks/useWidgetLayout";

interface SortableWidgetProps {
  id: WidgetId;
  isCustomizing: boolean;
  visible: boolean;
  label: string;
  onToggleVisibility: (id: WidgetId) => void;
  children: React.ReactNode;
}

export function SortableWidget({
  id,
  isCustomizing,
  visible,
  label,
  onToggleVisibility,
  children,
}: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isCustomizing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (!visible && !isCustomizing) return null;

  return (
    <div ref={setNodeRef} style={style} data-testid={`widget-${id}`}>
      <AnimatePresence>
        {isCustomizing && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 6 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-1">
              <button
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                data-testid={`widget-drag-${id}`}
              >
                <GripVertical className="w-4 h-4" />
              </button>
              <span className="text-xs font-medium text-muted-foreground flex-1">
                {label}
              </span>
              <button
                onClick={() => onToggleVisibility(id)}
                className={`p-1 rounded transition-colors ${visible ? "text-foreground hover:bg-secondary" : "text-muted-foreground/40 hover:bg-secondary"}`}
                data-testid={`widget-toggle-${id}`}
              >
                {visible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        animate={{
          outline: isCustomizing ? "1px dashed hsl(var(--border))" : "0px dashed transparent",
          borderRadius: isCustomizing ? 8 : 0,
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={`${!visible && isCustomizing ? "opacity-30 pointer-events-none" : ""}`}
      >
        {children}
      </motion.div>
    </div>
  );
}
