import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { RefreshCw, MonitorX } from "lucide-react";

interface WebGLErrorBoundaryProps {
  children: ReactNode;
}

interface WebGLErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class WebGLErrorBoundary extends Component<WebGLErrorBoundaryProps, WebGLErrorBoundaryState> {
  constructor(props: WebGLErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): WebGLErrorBoundaryState {
    const message = error.message || "WebGL context could not be created";
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[WebGL Error]", error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-[#0a0a0f]">
          <div className="max-w-sm w-full text-center space-y-4 p-8">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <MonitorX className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-lg font-bold text-white">WebGL Unavailable</h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {this.state.errorMessage || "Your browser or device does not support WebGL, or the graphics context was lost."}
            </p>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
              data-testid="button-webgl-retry"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
