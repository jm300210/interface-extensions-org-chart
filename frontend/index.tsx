import './style.css';
import React, { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { initializeBlock, useBase, useRecords, expandRecord, useCustomProperties, useRunInfo, CellRenderer } from '@airtable/blocks/interface/ui';
import { FieldType, Base, Table, Field, Record as AirtableRecord, type FieldConfig } from '@airtable/blocks/interface/models';
import { UserIcon, PlusIcon, MinusIcon } from '@phosphor-icons/react';

interface OrgNode {
  id: string;
  name: string;
  profilePicture: string | null;
  managerId: string | null;
  children: OrgNode[];
  collapsed: boolean;
  record: AirtableRecord;
}

interface NodePosition {
  x: number;
  y: number;
  depth: number;
}

interface LayoutNode {
  x: number;
  children: LayoutNode[];
  node: OrgNode;
}

const NODE_WIDTH = 272;
const MIN_GAP = 16;
const LEVEL_GAP = 60; // Vertical gap between levels

// Card height estimation constants (generous for spacing)
const CARD_BASE_HEIGHT = 78; // Header (photo + name) + card padding
const FIELD_HEIGHT = 44; // Height per additional field (label + value + spacing)
const BUTTON_HEIGHT = 44; // Height for collapse/expand button with margin
const HEIGHT_BUFFER = 24; // Extra buffer for spacing between levels

// Interaction constants
const INITIAL_TOP_PADDING = 60; // Padding from top when centering on root node
const DRAG_THRESHOLD = 5; // Minimum pixels moved to consider it a drag vs click
const INITIAL_X_OFFSET = 50; // Initial X offset for positioning root trees

interface LayoutResult {
  positions: Map<string, NodePosition>;
  nodeHeights: Map<string, number>;
  levelHeights: number[]; // Max height at each depth level
  levelYPositions: number[]; // Cumulative Y positions for each level
}

function calculateTreeLayout(
  nodes: OrgNode[],
  getFieldCount: (node: OrgNode) => number
): LayoutResult {
  // First, calculate height for each node
  const nodeHeights = new Map<string, number>();
  const levelMaxHeights = new Map<number, number>();
  
  function calculateHeights(node: OrgNode, depth: number) {
    const fieldCount = getFieldCount(node);
    const hasChildren = node.children.length > 0;
    const height = CARD_BASE_HEIGHT + (fieldCount * FIELD_HEIGHT) + (hasChildren ? BUTTON_HEIGHT : 0) + HEIGHT_BUFFER;
    nodeHeights.set(node.id, height);
    
    // Track max height at this depth
    const currentMax = levelMaxHeights.get(depth) || 0;
    levelMaxHeights.set(depth, Math.max(currentMax, height));
    
    if (!node.collapsed) {
      node.children.forEach(child => calculateHeights(child, depth + 1));
    }
  }
  
  nodes.forEach(root => calculateHeights(root, 0));
  
  // Convert level max heights to array and calculate cumulative Y positions
  const maxDepth = Math.max(...Array.from(levelMaxHeights.keys()), 0);
  const levelHeights: number[] = [];
  const levelYPositions: number[] = [0];
  
  for (let d = 0; d <= maxDepth; d++) {
    const height = levelMaxHeights.get(d) || CARD_BASE_HEIGHT;
    levelHeights.push(height);
    if (d < maxDepth) {
      levelYPositions.push(levelYPositions[d] + height + LEVEL_GAP);
    }
  }

  function buildLayout(node: OrgNode): LayoutNode {
    if (node.collapsed || node.children.length === 0) {
      return { x: 0, children: [], node };
    }
    
    const childLayouts = node.children.map(child => buildLayout(child));
    
    // Position children next to each other, accounting for contours
    for (let i = 1; i < childLayouts.length; i++) {
      const leftContour = getRightContour(childLayouts[i - 1], 0, [], 0);
      const rightContour = getLeftContour(childLayouts[i], 0, [], 0);
      
      let maxShift = 0;
      const maxDepth = Math.min(leftContour.length, rightContour.length);
      
      for (let d = 0; d < maxDepth; d++) {
        const neededShift = leftContour[d] - rightContour[d] + MIN_GAP;
        maxShift = Math.max(maxShift, neededShift);
      }
      
      // Also ensure top-level children don't overlap
      const prevChildRight = childLayouts[i - 1].x + NODE_WIDTH / 2;
      const thisChildLeft = childLayouts[i].x - NODE_WIDTH / 2;
      const directShift = prevChildRight - thisChildLeft + MIN_GAP;
      maxShift = Math.max(maxShift, directShift);
      
      // Only shift the root of the subtree - children are relative to it
      childLayouts[i].x += maxShift;
    }
    
    // Center parent over children
    const leftmostChild = childLayouts[0].x;
    const rightmostChild = childLayouts[childLayouts.length - 1].x;
    const centerX = (leftmostChild + rightmostChild) / 2;
    
    // Shift all children so parent is at x=0
    childLayouts.forEach(cl => { cl.x -= centerX; });
    
    return { x: 0, children: childLayouts, node };
  }
  
  // Get left contour accounting for cumulative parent offset
  function getLeftContour(layout: LayoutNode, depth = 0, contour: number[] = [], parentOffset = 0): number[] {
    const absoluteX = parentOffset + layout.x;
    const left = absoluteX - NODE_WIDTH / 2;
    if (contour.length <= depth) {
      contour.push(left);
    } else {
      contour[depth] = Math.min(contour[depth], left);
    }
    layout.children.forEach(cl => getLeftContour(cl, depth + 1, contour, absoluteX));
    return contour;
  }
  
  // Get right contour accounting for cumulative parent offset
  function getRightContour(layout: LayoutNode, depth = 0, contour: number[] = [], parentOffset = 0): number[] {
    const absoluteX = parentOffset + layout.x;
    const right = absoluteX + NODE_WIDTH / 2;
    if (contour.length <= depth) {
      contour.push(right);
    } else {
      contour[depth] = Math.max(contour[depth], right);
    }
    layout.children.forEach(cl => getRightContour(cl, depth + 1, contour, absoluteX));
    return contour;
  }
  
  function toAbsolute(
    layout: LayoutNode,
    parentX: number,
    depth: number,
    positions: Map<string, NodePosition>
  ) {
    const absoluteX = parentX + layout.x;
    const y = levelYPositions[depth] || 0;
    positions.set(layout.node.id, { x: absoluteX, y, depth });
    layout.children.forEach(cl => toAbsolute(cl, absoluteX, depth + 1, positions));
  }
  
  const positions = new Map<string, NodePosition>();
  let currentX = INITIAL_X_OFFSET;
  
  for (const root of nodes) {
    const layout = buildLayout(root);
    const leftContour = getLeftContour(layout, 0, [], 0);
    const rightContour = getRightContour(layout, 0, [], 0);
    
    const leftmost = Math.min(...leftContour);
    const shift = currentX - leftmost;
    layout.x += shift;
    
    toAbsolute(layout, 0, 0, positions);
    
    const rightmostAfterShift = Math.max(...rightContour) + shift;
    currentX = rightmostAfterShift + MIN_GAP * 2;
  }
  
  return { positions, nodeHeights, levelHeights, levelYPositions };
}

// Recursively collect all visible nodes for rendering (pure function, no component dependencies)
function collectAllNodes(nodes: OrgNode[]): OrgNode[] {
  const result: OrgNode[] = [];
  function collect(node: OrgNode) {
    result.push(node);
    if (!node.collapsed) {
      node.children.forEach(collect);
    }
  }
  nodes.forEach(collect);
  return result;
}

function getCustomProperties(base: Base) {
  const defaultTable = base.tables[0];

  return [
    {
      key: 'employeesTable',
      label: 'Employees Table',
      type: 'table' as const,
      defaultValue: defaultTable,
    },
    {
      key: 'nameField',
      label: 'Name Field',
      type: 'field' as const,
      table: defaultTable,
      defaultValue: defaultTable?.getFieldIfExists('Name') ?? undefined,
    },
    {
      key: 'profilePictureField',
      label: 'Profile Picture Field',
      type: 'field' as const,
      table: defaultTable,
      shouldFieldBeAllowed: (field: {id: string; config: FieldConfig}) => field.config.type === FieldType.MULTIPLE_ATTACHMENTS,
      defaultValue: defaultTable?.getFieldIfExists('Profile Picture') ?? undefined,
    },
    {
      key: 'managerField',
      label: 'Manager Field',
      type: 'field' as const,
      table: defaultTable,
      shouldFieldBeAllowed: (field: {id: string; config: FieldConfig}) => field.config.type === FieldType.MULTIPLE_RECORD_LINKS,
      defaultValue: defaultTable?.getFieldIfExists('Manager') ?? undefined,
    },
    {
      key: 'cardProperty1',
      label: 'Card Property (1)',
      type: 'field' as const,
      table: defaultTable,
      defaultValue: undefined,
    },
    {
      key: 'cardProperty2',
      label: 'Card Property (2)',
      type: 'field' as const,
      table: defaultTable,
      defaultValue: undefined,
    },
    {
      key: 'cardProperty3',
      label: 'Card Property (3)',
      type: 'field' as const,
      table: defaultTable,
      defaultValue: undefined,
    },
  ];
}

function NodeCard({
  node,
  position,
  canvasBounds,
  canExpandRecords,
  fieldsWithValues,
  onCardClick,
  onCardKeyDown,
  onToggleCollapse,
}: {
  node: OrgNode;
  position: NodePosition;
  canvasBounds: { offsetX: number; offsetY: number };
  canExpandRecords: boolean;
  fieldsWithValues: Field[];
  onCardClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCardKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onToggleCollapse: (e: React.MouseEvent<HTMLButtonElement>) => void;
}): React.ReactElement {
  const hasChildren = node.children.length > 0;

  return (
    <div
      className="absolute"
      style={{
        left: position.x + canvasBounds.offsetX - NODE_WIDTH / 2,
        top: position.y + canvasBounds.offsetY,
        width: NODE_WIDTH,
      }}
    >
      <div
        role={canExpandRecords ? 'button' : undefined}
        tabIndex={canExpandRecords ? 0 : undefined}
        aria-label={canExpandRecords ? `View details for ${node.name}` : undefined}
        data-node-id={node.id}
        className={`bg-white dark:bg-gray-700 rounded-lg shadow-md hover:shadow-lg transition-shadow p-4 border border-gray-200 dark:border-gray-600 ${
          canExpandRecords ? 'cursor-pointer' : ''
        }`}
        onClick={onCardClick}
        onKeyDown={canExpandRecords ? onCardKeyDown : undefined}
      >
        <div className="flex items-start gap-3 mb-3">
          {node.profilePicture ? (
            <img
              src={node.profilePicture}
              alt={node.name}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
              draggable={false}
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0" aria-hidden="true">
              <UserIcon size={24} className="text-gray-500 dark:text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base text-gray-900 dark:text-white truncate">
              {node.name}
            </h3>
          </div>
        </div>

        {fieldsWithValues.length > 0 && (
          <div className="space-y-1.5 text-xs">
            {fieldsWithValues.map((field: Field) => {
              const isSelectField = field.type === FieldType.SINGLE_SELECT || field.type === FieldType.MULTIPLE_SELECTS;
              return (
                <div key={field.id}>
                  <div className={`font-medium text-gray-500 dark:text-gray-500 ${isSelectField ? 'mb-1' : ''}`}>{field.name}</div>
                  <div className="text-gray-700 dark:text-gray-300">
                    <CellRenderer record={node.record} field={field} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasChildren && (
          <button
            aria-expanded={!node.collapsed}
            aria-label={node.collapsed ? `Show ${node.children.length} direct report${node.children.length !== 1 ? 's' : ''} for ${node.name}` : `Hide direct reports for ${node.name}`}
            data-node-id={node.id}
            className="mt-3 w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-md text-xs font-medium"
            onClick={onToggleCollapse}
          >
            {node.collapsed ? `Show ${node.children.length} Report${node.children.length !== 1 ? 's' : ''}` : 'Hide Reports'}
          </button>
        )}
      </div>
    </div>
  );
}

function OrgChartApp(): React.ReactElement {
  const base = useBase();
  const { customPropertyValueByKey, errorState } = useCustomProperties(useCallback(getCustomProperties, []));

  const table = customPropertyValueByKey.employeesTable as Table | undefined;
  const records = useRecords(table || base.tables[0]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const hasInitializedView = useRef(false);
  // Track anchor node to keep it stationary during collapse/expand
  const anchorNode = useRef<{nodeId: string; screenX: number; screenY: number} | null>(null);
  // Track if actual dragging movement occurred (to prevent click after drag)
  const hasDraggedRef = useRef(false);
  const mouseDownPosRef = useRef({ x: 0, y: 0 });

  const runInfo = useRunInfo();
  const canExpandRecords = table?.hasPermissionToExpandRecords() || runInfo.isPageElementInEditMode;

  // Required fields for the org chart to function
  const nameField = customPropertyValueByKey.nameField as Field | undefined;
  const profilePictureField = customPropertyValueByKey.profilePictureField as Field | undefined;
  const managerField = customPropertyValueByKey.managerField as Field | undefined;

  // Optional card property fields
  const cardProperty1 = customPropertyValueByKey.cardProperty1 as Field | undefined;
  const cardProperty2 = customPropertyValueByKey.cardProperty2 as Field | undefined;
  const cardProperty3 = customPropertyValueByKey.cardProperty3 as Field | undefined;

  const requiredFieldsConfigured = nameField && profilePictureField && managerField;

  // Get configured card property fields (filtering out undefined values)
  const configuredCardFields = useMemo(() => {
    return [cardProperty1, cardProperty2, cardProperty3].filter((field): field is Field => field !== undefined);
  }, [cardProperty1, cardProperty2, cardProperty3]);

  const orgData = useMemo(() => {
    if (!table || !records || !requiredFieldsConfigured) return [];

    const nodes: Map<string, OrgNode> = new Map();

    records.forEach(record => {
      const managerValue = managerField ? record.getCellValue(managerField) : null;
      const managerId = managerValue && Array.isArray(managerValue) && managerValue.length > 0
        ? managerValue[0].id
        : null;

      const profilePictureValue = profilePictureField ? record.getCellValue(profilePictureField) : null;
      const profilePicture = profilePictureValue && Array.isArray(profilePictureValue) && profilePictureValue.length > 0
        ? profilePictureValue[0].url
        : null;

      nodes.set(record.id, {
        id: record.id,
        name: nameField ? record.getCellValueAsString(nameField) : '',
        profilePicture,
        managerId,
        children: [],
        collapsed: collapsedNodes.has(record.id),
        record,
      });
    });

    nodes.forEach(node => {
      if (node.managerId && nodes.has(node.managerId)) {
        const parent = nodes.get(node.managerId);
        if (parent) {
          parent.children.push(node);
        }
      }
    });

    const rootNodes = Array.from(nodes.values()).filter(node => !node.managerId || !nodes.has(node.managerId));

    return rootNodes;
  }, [table, records, collapsedNodes, nameField, profilePictureField, managerField, requiredFieldsConfigured]);

  // Event handler that extracts node ID from data attribute
  const handleNodeCardClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Prevent opening record detail if this click followed a drag
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }
    const nodeId = e.currentTarget.dataset.nodeId;
    if (!nodeId || !table) return;
    const record = records?.find(r => r.id === nodeId);
    if (record && canExpandRecords) {
      expandRecord(record);
    }
  }, [table, records, canExpandRecords]);

  // Keyboard handler for node cards (Enter/Space to activate)
  const handleNodeCardKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const nodeId = e.currentTarget.dataset.nodeId;
      if (!nodeId || !table) return;
      const record = records?.find(r => r.id === nodeId);
      if (record && canExpandRecords) {
        expandRecord(record);
      }
    }
  }, [table, records, canExpandRecords]);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 0.1, 2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 0.1, 0.3));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement).closest('.org-canvas')) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
      hasDraggedRef.current = false;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      // Check if we've moved more than a small threshold to consider it a real drag
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > DRAG_THRESHOLD) {
        hasDraggedRef.current = true;
      }
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();

    // Get cursor position relative to the container
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // Calculate the point in canvas space that's under the cursor
    const canvasX = (cursorX - pan.x) / zoom;
    const canvasY = (cursorY - pan.y) / zoom;

    // Calculate new zoom level
    const zoomIntensity = 0.001;
    const delta = -e.deltaY * zoomIntensity;
    const newZoom = Math.max(0.3, Math.min(2, zoom * (1 + delta)));

    // Calculate new pan to keep the cursor point stationary
    const newPanX = cursorX - canvasX * newZoom;
    const newPanY = cursorY - canvasY * newZoom;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  // Get card property fields that have values for this record
  const getFieldsWithValues = useCallback((record: AirtableRecord): Field[] => {
    return configuredCardFields.filter((field: Field) => {
      const value = record.getCellValue(field);
      // Check for null/undefined
      if (value === null || value === undefined) return false;
      // Check for empty strings or whitespace-only strings
      if (typeof value === 'string' && value.trim() === '') return false;
      // Check for empty arrays (multi-select, attachments, linked records, etc.)
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    });
  }, [configuredCardFields]);

  // Get field count for a node (used for height calculation)
  const getFieldCount = useCallback((node: OrgNode): number => {
    return getFieldsWithValues(node.record).length;
  }, [getFieldsWithValues]);

  // Calculate positions using tree layout algorithm
  const layoutResult = useMemo(() => calculateTreeLayout(orgData, getFieldCount), [orgData, getFieldCount]);
  const { positions, nodeHeights, levelHeights, levelYPositions } = layoutResult;

  // Calculate canvas bounds
  const canvasBounds = useMemo(() => {
    if (positions.size === 0) {
      return { width: 800, height: 600, offsetX: 50, offsetY: 50 };
    }
    let minX = Infinity, maxX = -Infinity;
    // Calculate max Y based on level positions and heights
    const lastLevelIndex = levelYPositions.length - 1;
    const maxY = (levelYPositions[lastLevelIndex] || 0) + (levelHeights[lastLevelIndex] || CARD_BASE_HEIGHT);
    
    positions.forEach(pos => {
      minX = Math.min(minX, pos.x - NODE_WIDTH / 2);
      maxX = Math.max(maxX, pos.x + NODE_WIDTH / 2);
    });
    return {
      width: Math.max(800, maxX - minX + 100),
      height: Math.max(600, maxY + 100),
      offsetX: -minX + 50,
      offsetY: 50
    };
  }, [positions, levelYPositions, levelHeights]);

  const handleToggleCollapse = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const nodeId = e.currentTarget.dataset.nodeId;
    if (!nodeId) return;

    // Capture the node's current screen position before the layout changes
    const oldPos = positions.get(nodeId);
    if (oldPos) {
      // Calculate current screen position: (canvasPos + offset) * zoom + pan
      const canvasX = oldPos.x + canvasBounds.offsetX;
      const canvasY = oldPos.y + canvasBounds.offsetY;
      anchorNode.current = {
        nodeId,
        screenX: canvasX * zoom + pan.x,
        screenY: canvasY * zoom + pan.y,
      };
    }
    setCollapsedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  }, [positions, canvasBounds, zoom, pan]);

  const handleResetView = useCallback(() => {
    setZoom(1);
    
    // Reset to centered view on root node
    if (orgData.length > 0 && containerRef.current) {
      const rootNode = orgData[0];
      const rootPos = positions.get(rootNode.id);
      if (rootPos) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const viewportWidth = containerRect.width;
        
        const rootCanvasX = rootPos.x + canvasBounds.offsetX;
        const rootCanvasY = rootPos.y + canvasBounds.offsetY;
        
        const initialPanX = (viewportWidth / 2) - rootCanvasX;
        const initialPanY = INITIAL_TOP_PADDING - rootCanvasY;
        
        setPan({ x: initialPanX, y: initialPanY });
        return;
      }
    }
    setPan({ x: 0, y: 0 });
  }, [orgData, positions, canvasBounds]);

  // Collect all connector lines - connecting from bottom of parent cards to top of child cards
  const connectorLines = useMemo(() => {
    const lines: Array<{x1: number, y1: number, x2: number, y2: number, key: string}> = [];
    
    function collectLines(node: OrgNode) {
      const parentPos = positions.get(node.id);
      if (!parentPos || node.collapsed) return;
      
      if (node.children.length === 0) return;
      
      // Get all visible children positions
      const childPositions = node.children
        .map(child => positions.get(child.id))
        .filter((pos): pos is NodePosition => pos !== undefined);
      
      if (childPositions.length === 0) return;
      
      // Get the parent card's actual height (without the buffer which is just for spacing)
      const parentHeight = (nodeHeights.get(node.id) || CARD_BASE_HEIGHT) - HEIGHT_BUFFER;
      
      // Parent card bottom position
      const parentBottom = parentPos.y + parentHeight;
      
      // Child cards top position
      const childY = childPositions[0].y;
      
      // Horizontal connector line is placed midway between parent bottom and child top
      const connectorY = parentBottom + (childY - parentBottom) / 2;
      
      // Draw vertical line from parent bottom down to connector level
      lines.push({
        x1: parentPos.x,
        y1: parentBottom,
        x2: parentPos.x,
        y2: connectorY,
        key: `v1-${node.id}`
      });
      
      // Draw horizontal line spanning all children AND the parent's x position
      const childXs = childPositions.map(p => p.x);
      const leftmostX = Math.min(...childXs, parentPos.x);
      const rightmostX = Math.max(...childXs, parentPos.x);
      
      if (leftmostX !== rightmostX) {
        lines.push({
          x1: leftmostX,
          y1: connectorY,
          x2: rightmostX,
          y2: connectorY,
          key: `h-${node.id}`
        });
      }
      
      // Draw vertical lines from connector down to each child
      node.children.forEach(child => {
        const childPos = positions.get(child.id);
        if (childPos) {
          lines.push({
            x1: childPos.x,
            y1: connectorY,
            x2: childPos.x,
            y2: childPos.y,
            key: `v2-${node.id}-${child.id}`
          });
        }
        
        collectLines(child);
      });
    }
    
    orgData.forEach(root => collectLines(root));
    return lines;
  }, [orgData, positions, nodeHeights]);

  const allNodes = useMemo(() => collectAllNodes(orgData), [orgData]);

  // Cache fields with values per node to avoid recalculating during render
  const nodeFieldsMap = useMemo(() => {
    const map = new Map<string, Field[]>();
    allNodes.forEach(node => {
      map.set(node.id, getFieldsWithValues(node.record));
    });
    return map;
  }, [allNodes, getFieldsWithValues]);

  // After DOM commit but before paint, directly set transform to prevent visual jump
  // useLayoutEffect runs synchronously after React's DOM mutations but before browser paint
  useLayoutEffect(() => {
    if (!anchorNode.current || !canvasRef.current) return;
    
    const { nodeId, screenX, screenY } = anchorNode.current;
    const newPos = positions.get(nodeId);
    
    if (newPos) {
      const newCanvasX = newPos.x + canvasBounds.offsetX;
      const newCanvasY = newPos.y + canvasBounds.offsetY;
      const newPan = {
        x: screenX - newCanvasX * zoom,
        y: screenY - newCanvasY * zoom,
      };
      
      // Directly set the transform on the DOM element - this bypasses React
      canvasRef.current.style.transition = 'none';
      canvasRef.current.style.transform = `translate(${newPan.x}px, ${newPan.y}px) scale(${zoom})`;
      
      // Clear anchor and update React state
      anchorNode.current = null;
      
      // Use a microtask to update state after the current execution
      // This prevents React from batching it with other updates
      queueMicrotask(() => {
        setPan(newPan);
      });
    } else {
      anchorNode.current = null;
    }
  }, [positions, canvasBounds, zoom]);

  // Calculate initial centered view on the root node
  useEffect(() => {
    if (hasInitializedView.current) return;
    if (orgData.length === 0) return;
    if (!containerRef.current) return;
    
    // Get the first root node's position
    const rootNode = orgData[0];
    const rootPos = positions.get(rootNode.id);
    if (!rootPos) return;
    
    // Get viewport dimensions
    const containerRect = containerRef.current.getBoundingClientRect();
    const viewportWidth = containerRect.width;
    
    // Calculate the root node's position in canvas coordinates
    const rootCanvasX = rootPos.x + canvasBounds.offsetX;
    const rootCanvasY = rootPos.y + canvasBounds.offsetY;
    
    // Calculate pan to center the root node horizontally
    // and position it near the top with some padding
    const initialPanX = (viewportWidth / 2) - rootCanvasX;
    const initialPanY = INITIAL_TOP_PADDING - rootCanvasY;
    
    setPan({ x: initialPanX, y: initialPanY });
    hasInitializedView.current = true;
  }, [orgData, positions, canvasBounds]);

  if (!table) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-800">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">Table not found</p>
        </div>
      </div>
    );
  }

  if (errorState) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-800">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">Error loading custom properties</p>
        </div>
      </div>
    );
  }

  if (!requiredFieldsConfigured) {
    const missingFields: string[] = [];
    if (!nameField) missingFields.push('Name');
    if (!profilePictureField) missingFields.push('Profile Picture');
    if (!managerField) missingFields.push('Manager');

    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-800">
        <div className="text-center max-w-md mx-auto p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Configuration Required
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Please configure the required fields in the properties panel to display the org chart.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Missing fields: {missingFields.join(', ')}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-800 relative overflow-hidden">
      <div className="absolute top-4 right-4 z-10 flex gap-2" role="toolbar" aria-label="Zoom controls">
        <button
          onClick={handleZoomIn}
          aria-label="Zoom in"
          className="bg-white dark:bg-gray-600 hover:bg-black/5 dark:hover:bg-white/5 dark:text-white px-3 py-1.5 rounded-md shadow-xs hover:shadow-sm hover:cursor-pointer flex items-center gap-1.5"
        >
          <PlusIcon size={16} aria-hidden="true" />
        </button>
        <button
          onClick={handleZoomOut}
          aria-label="Zoom out"
          className="bg-white dark:bg-gray-600 hover:bg-black/5 dark:hover:bg-white/5 dark:text-white px-3 py-1.5 rounded-md shadow-xs hover:shadow-sm hover:cursor-pointer flex items-center gap-1.5"
        >
          <MinusIcon size={16} aria-hidden="true" />
        </button>
        <button
          onClick={handleResetView}
          aria-label="Reset view to default zoom and position"
          className="bg-white dark:bg-gray-600 hover:bg-black/5 dark:hover:bg-white/5 dark:text-white px-3 py-1.5 rounded-md shadow-xs hover:shadow-sm hover:cursor-pointer"
        >
          Reset View
        </button>
      </div>

      <div
        ref={containerRef}
        className="org-canvas w-full h-screen overflow-hidden cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          ref={canvasRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            width: canvasBounds.width,
            height: canvasBounds.height,
          }}
          className="relative"
        >
          {orgData.length === 0 ? (
            <div className="text-center mt-20">
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                No employees found in the directory
              </p>
            </div>
          ) : (
            <>
              {/* SVG layer for connector lines */}
              <svg
                className="absolute inset-0 pointer-events-none"
                style={{ width: canvasBounds.width, height: canvasBounds.height }}
              >
                {connectorLines.map(line => (
                  <line
                    key={line.key}
                    x1={line.x1 + canvasBounds.offsetX}
                    y1={line.y1 + canvasBounds.offsetY}
                    x2={line.x2 + canvasBounds.offsetX}
                    y2={line.y2 + canvasBounds.offsetY}
                    className="stroke-gray-300 dark:stroke-gray-600"
                    strokeWidth={2}
                  />
                ))}
              </svg>
              
              {/* Node cards */}
              {allNodes.map(node => {
                const pos = positions.get(node.id);
                if (!pos) return null;
                return (
                  <NodeCard
                    key={node.id}
                    node={node}
                    position={pos}
                    canvasBounds={canvasBounds}
                    canExpandRecords={canExpandRecords}
                    fieldsWithValues={nodeFieldsMap.get(node.id) || []}
                    onCardClick={handleNodeCardClick}
                    onCardKeyDown={handleNodeCardKeyDown}
                    onToggleCollapse={handleToggleCollapse}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

initializeBlock({ interface: () => <OrgChartApp /> });
