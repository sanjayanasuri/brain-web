import type { Concept, Resource } from '../../api-client';

export type ActivityEventType =
    | 'RESOURCE_ATTACHED'
    | 'NODE_CREATED'
    | 'NODE_UPDATED'
    | 'RELATIONSHIP_ADDED'
    | 'RELATIONSHIP_REMOVED';

export interface ActivityEvent {
    id: string;
    type: ActivityEventType;
    title: string;
    timestamp: Date | null;
    detail?: string;
    resource_id?: string;
    url?: string;
    source_badge?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}

export type VisualNode = Concept & { domain: string; type: string; x?: number; y?: number };

export type VisualLink = {
    source: VisualNode;
    target: VisualNode;
    predicate: string;
    relationship_status?: string;
    relationship_confidence?: number;
    relationship_method?: string;
    source_type?: string;
    rationale?: string;
};

export type TempNode = VisualNode & { temporary: true };

export type VisualGraph = {
    nodes: VisualNode[];
    links: VisualLink[];
};

export type SerializedGraph = {
    nodes: Concept[];
    links: { source: string; target: string; predicate: string }[];
};

export type DomainBubble = {
    domain: string;
    x: number;
    y: number;
    r: number;
    radius?: number;
    color: string;
    count: number;
};

export type ForceGraphRef = {
    graphData: () => any;
    getGraphData: () => any;
    graph2ScreenCoords: (x: number, y: number) => { x: number; y: number } | null;
    centerAt: (x: number, y: number, duration?: number) => void;
    zoom: {
        (k: number, duration?: number): void;
        (): number;
    };
    zoomToFit: (duration?: number, padding?: number) => void;
    refresh: () => void;
    d3ReheatSimulation: () => void;
    toDataURL?: () => string;
    d3Force: (name: string) => any;
};
