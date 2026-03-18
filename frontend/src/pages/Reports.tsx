import { useState, useEffect } from 'react';
import { Layout } from '../components/Layout';
import { boards as boardsApi, metrics, sprints as sprintsApi } from '../api/client';
import { Board, Sprint, SprintMetrics, VelocityPoint } from '../types';
import {
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { TrendingDown, TrendingUp, Activity, Clock } from 'lucide-react';

export function Reports() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(null);
  const [burndownData, setBurndownData] = useState<SprintMetrics[]>([]);
  const [velocityData, setVelocityData] = useState<VelocityPoint[]>([]);
  const [timeSummary, setTimeSummary] = useState<{
    by_user: Array<{ user_id: number; display_name: string; total_logged: number }>;
    total_logged: number;
    total_estimated: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBoards();
  }, []);

  useEffect(() => {
    if (selectedBoard) {
      loadBoardData(selectedBoard.id);
    }
  }, [selectedBoard]);

  useEffect(() => {
    if (selectedSprint) {
      loadSprintMetrics(selectedSprint.id);
    }
  }, [selectedSprint]);

  useEffect(() => {
    if (selectedBoard) {
      loadTimeSummary(selectedBoard.id, selectedSprint?.id);
    }
  }, [selectedBoard, selectedSprint]);

  const loadBoards = async () => {
    try {
      const data = await boardsApi.list();
      setBoards(data || []);
      if (data?.length > 0) {
        setSelectedBoard(data[0]);
      }
    } catch (err: any) {
      console.error('Failed to load boards:', err);
      setError(err?.message || 'Failed to load boards');
    } finally {
      setLoading(false);
    }
  };

  const loadBoardData = async (boardId: number) => {
    try {
      const [sprintsData, velocityResponse] = await Promise.all([
        sprintsApi.list(boardId),
        metrics.velocity(boardId).catch(() => []),
      ]);
      setSprints(sprintsData || []);
      setVelocityData(velocityResponse || []);

      // Select active sprint or most recent
      const active = sprintsData?.find((s: Sprint) => s.status === 'active');
      const completed = sprintsData?.filter((s: Sprint) => s.status === 'completed') || [];
      setSelectedSprint(active || completed[0] || null);
    } catch (err: any) {
      console.error('Failed to load board data:', err);
      setError(err?.message || 'Failed to load board data');
    }
  };

  const loadSprintMetrics = async (sprintId: number) => {
    try {
      const data = await metrics.burndown(sprintId);
      setBurndownData(data || []);
    } catch (err: any) {
      console.error('Failed to load sprint metrics:', err);
      setError(err?.message || 'Failed to load sprint metrics');
    }
  };

  const loadTimeSummary = async (boardId: number, sprintId?: number) => {
    try {
      const data = await boardsApi.getTimeSummary(boardId, sprintId);
      setTimeSummary(data);
    } catch (err: any) {
      console.error('Failed to load time summary:', err);
    }
  };

  // Calculate ideal burndown line
  const getIdealBurndown = () => {
    if (burndownData.length === 0 || !selectedSprint) return [];
    const startPoints = burndownData[0]?.total_points || 0;
    const totalDays = burndownData.length;

    return burndownData.map((_, index) => ({
      date: burndownData[index]?.date || `Day ${index + 1}`,
      ideal: Math.max(0, startPoints - (startPoints * (index / (totalDays - 1 || 1)))),
      remaining: burndownData[index]?.remaining_points || 0,
    }));
  };

  const burndownChartData = getIdealBurndown();

  // Calculate average velocity
  const avgVelocity = velocityData.length > 0
    ? Math.round(velocityData.reduce((sum, v) => sum + v.completed_points, 0) / velocityData.length)
    : 0;

  // Calculate sprint completion percentage
  const sprintCompletion = burndownData.length > 0
    ? Math.round(
        ((burndownData[burndownData.length - 1]?.completed_points || 0) /
          (burndownData[burndownData.length - 1]?.total_points || 1)) *
          100
      )
    : 0;

  if (loading) {
    return (
      <Layout>
        <div className="loading">Loading reports...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="reports-page">
        {error && (
          <div className="error-banner" style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '12px 16px', marginBottom: '16px' }}>
            {error}
            <button onClick={() => setError('')} style={{ marginLeft: '12px', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 'bold' }}>&times;</button>
          </div>
        )}
        <div className="page-header">
          <h1>Reports</h1>
          <div className="reports-filters">
            <select
              value={selectedBoard?.id || ''}
              onChange={(e) => {
                const board = boards.find((b) => b.id === parseInt(e.target.value));
                setSelectedBoard(board || null);
              }}
            >
              <option value="">Select a board...</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>

            {selectedBoard && sprints.length > 0 && (
              <select
                value={selectedSprint?.id || ''}
                onChange={(e) => {
                  const sprint = sprints.find((s) => s.id === parseInt(e.target.value));
                  setSelectedSprint(sprint || null);
                }}
              >
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name} ({sprint.status})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {!selectedBoard ? (
          <div className="empty-state">
            <Activity size={48} />
            <h2>Select a board to view reports</h2>
            <p>Choose a board from the dropdown above to see sprint metrics and velocity charts.</p>
          </div>
        ) : sprints.length === 0 ? (
          <div className="empty-state">
            <Activity size={48} />
            <h2>No sprints found</h2>
            <p>Create sprints in your board to start tracking velocity and burndown.</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="metrics-summary">
              <div className="metric-card">
                <div className="metric-icon">
                  <TrendingDown size={24} />
                </div>
                <div className="metric-content">
                  <span className="metric-label">Sprint Completion</span>
                  <span className="metric-value">{sprintCompletion}%</span>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-icon">
                  <TrendingUp size={24} />
                </div>
                <div className="metric-content">
                  <span className="metric-label">Avg Velocity</span>
                  <span className="metric-value">{avgVelocity} pts</span>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-icon">
                  <Activity size={24} />
                </div>
                <div className="metric-content">
                  <span className="metric-label">Completed Sprints</span>
                  <span className="metric-value">
                    {sprints.filter((s) => s.status === 'completed').length}
                  </span>
                </div>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="charts-grid">
              {/* Burndown Chart */}
              <div className="chart-card">
                <h3>Sprint Burndown</h3>
                {burndownChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={burndownChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        }
                      />
                      <YAxis />
                      <Tooltip
                        labelFormatter={(value) => new Date(value as string).toLocaleDateString()}
                        formatter={(value, name) => [
                          `${value} pts`,
                          name === 'ideal' ? 'Ideal' : 'Remaining',
                        ]}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="ideal"
                        stroke="#9ca3af"
                        strokeDasharray="5 5"
                        dot={false}
                        name="Ideal"
                      />
                      <Area
                        type="monotone"
                        dataKey="remaining"
                        stroke="#6366f1"
                        fill="#6366f1"
                        fillOpacity={0.3}
                        name="Remaining"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">
                    <p>No data available for this sprint</p>
                  </div>
                )}
              </div>

              {/* Velocity Chart */}
              <div className="chart-card">
                <h3>Velocity Trend</h3>
                {velocityData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={velocityData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sprint_name" />
                      <YAxis />
                      <Tooltip
                        formatter={(value, name) => [
                          `${value} pts`,
                          name === 'completed_points' ? 'Completed' : 'Committed',
                        ]}
                      />
                      <Legend />
                      <Bar
                        dataKey="total_points"
                        fill="#e5e7eb"
                        name="Committed"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="completed_points"
                        fill="#6366f1"
                        name="Completed"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">
                    <p>Complete sprints to see velocity data</p>
                  </div>
                )}
              </div>

              {/* Cumulative Flow Diagram */}
              <div className="chart-card wide">
                <h3>Cumulative Flow</h3>
                {burndownData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={burndownData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        }
                      />
                      <YAxis />
                      <Tooltip
                        labelFormatter={(value) => new Date(value).toLocaleDateString()}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="remaining_points"
                        stackId="1"
                        stroke="#f97316"
                        fill="#f97316"
                        fillOpacity={0.6}
                        name="Remaining"
                      />
                      <Area
                        type="monotone"
                        dataKey="completed_points"
                        stackId="1"
                        stroke="#22c55e"
                        fill="#22c55e"
                        fillOpacity={0.6}
                        name="Completed"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">
                    <p>No data available</p>
                  </div>
                )}
              </div>
            </div>

            {/* Time Tracking Section */}
            {timeSummary && (
              <div className="time-tracking-section">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '32px', marginBottom: '16px' }}>
                  <Clock size={24} />
                  Time Tracking
                </h2>

                {/* Total Logged vs Estimated */}
                <div className="chart-card" style={{ marginBottom: '16px' }}>
                  <h3>Total Time: Logged vs Estimated</h3>
                  <div style={{ padding: '16px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: '#6b7280' }}>
                      <span>
                        {Math.floor(timeSummary.total_logged / 60)}h {timeSummary.total_logged % 60}m logged
                      </span>
                      <span>
                        {timeSummary.total_estimated > 0
                          ? `${Math.floor(timeSummary.total_estimated / 60)}h ${timeSummary.total_estimated % 60}m estimated`
                          : 'No estimate'}
                      </span>
                    </div>
                    <div style={{ background: '#e5e7eb', borderRadius: '8px', height: '24px', overflow: 'hidden' }}>
                      <div
                        style={{
                          background: timeSummary.total_estimated > 0 && timeSummary.total_logged > timeSummary.total_estimated
                            ? '#ef4444'
                            : '#6366f1',
                          height: '100%',
                          borderRadius: '8px',
                          width: timeSummary.total_estimated > 0
                            ? `${Math.min(100, (timeSummary.total_logged / timeSummary.total_estimated) * 100)}%`
                            : '0%',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    {timeSummary.total_estimated > 0 && (
                      <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '13px', color: '#6b7280' }}>
                        {Math.round((timeSummary.total_logged / timeSummary.total_estimated) * 100)}% of estimate used
                      </div>
                    )}
                  </div>
                </div>

                {/* Per-User Bar Chart */}
                <div className="chart-card">
                  <h3>Time Logged by Team Member</h3>
                  {timeSummary.by_user.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={timeSummary.by_user.map((u) => ({
                          name: u.display_name,
                          hours: Math.round((u.total_logged / 60) * 100) / 100,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
                        <Tooltip formatter={(value) => [`${value}h`, 'Time Logged']} />
                        <Bar dataKey="hours" fill="#6366f1" name="Hours Logged" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="chart-empty">
                      <p>No time logged yet</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
