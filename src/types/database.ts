export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          user_id: string | null;
          email: string | null;
          phone: string | null;
          full_name: string | null;
          role: 'student' | 'volunteer' | 'supervisor' | 'admin';
          avatar_url: string | null;
          avatar_color: string;
          branch_id: string | null;
          status: 'active' | 'disabled';
          gender: 'm' | 'f' | null;
          joined_at: string;
          created_at?: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          email?: string | null;
          phone?: string | null;
          full_name?: string | null;
          role?: 'student' | 'volunteer' | 'supervisor' | 'admin';
          avatar_url?: string | null;
          avatar_color?: string;
          branch_id?: string | null;
          status?: 'active' | 'disabled';
          gender?: 'm' | 'f' | null;
          joined_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          email?: string | null;
          phone?: string | null;
          full_name?: string | null;
          role?: 'student' | 'volunteer' | 'supervisor' | 'admin';
          avatar_url?: string | null;
          avatar_color?: string;
          branch_id?: string | null;
          status?: 'active' | 'disabled';
          gender?: 'm' | 'f' | null;
          joined_at?: string;
          created_at?: string;
        };
      };
      branches: {
        Row: {
          id: string;
          name: string;
          governorate: string;
          address: string | null;
          phone: string | null;
          email: string | null;
          facebook_url: string | null;
          supervisor_id: string | null;
          status: 'active' | 'inactive';
          created_at?: string;
        };
        Insert: {
          id?: string;
          name: string;
          governorate: string;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          facebook_url?: string | null;
          supervisor_id?: string | null;
          status?: 'active' | 'inactive';
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          governorate?: string;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          facebook_url?: string | null;
          supervisor_id?: string | null;
          status?: 'active' | 'inactive';
          created_at?: string;
        };
      };
      committees: {
        Row: {
          id: string;
          branch_id: string;
          name: string;
          created_at?: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          branch_id?: string;
          name?: string;
          created_at?: string;
        };
      };
      courses: {
        Row: {
          id: string;
          committee_id: string | null;
          title: string;
          field: string;
          description: string | null;
          topics: string[];
          sessions_count: number;
          status: 'draft' | 'published' | 'archived';
          color: string;
          created_at?: string;
        };
        Insert: {
          id?: string;
          committee_id?: string | null;
          title: string;
          field: string;
          description?: string | null;
          topics?: string[];
          sessions_count?: number;
          status?: 'draft' | 'published' | 'archived';
          color?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          committee_id?: string | null;
          title?: string;
          field?: string;
          description?: string | null;
          topics?: string[];
          sessions_count?: number;
          status?: 'draft' | 'published' | 'archived';
          color?: string;
          created_at?: string;
        };
      };
      batches: {
        Row: {
          id: string;
          course_id: string;
          branch_id: string;
          instructor_id: string | null;
          capacity: number;
          schedule: Json;
          start_date: string;
          room: string | null;
          status: 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled';
          join_code: string | null;
          geofence_enabled: boolean;
          latitude: number | null;
          longitude: number | null;
          radius_m: number;
          created_at?: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          branch_id: string;
          instructor_id?: string | null;
          capacity?: number;
          schedule: Json;
          start_date: string;
          room?: string | null;
          status?: 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled';
          join_code?: string | null;
          geofence_enabled?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          radius_m?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          course_id?: string;
          branch_id?: string;
          instructor_id?: string | null;
          capacity?: number;
          schedule?: Json;
          start_date?: string;
          room?: string | null;
          status?: 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled';
          join_code?: string | null;
          geofence_enabled?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          radius_m?: number;
          created_at?: string;
        };
      };
      enrollments: {
        Row: {
          user_id: string;
          batch_id: string;
          status: 'active' | 'waitlist' | 'completed' | 'dropped';
          joined_at: string;
        };
        Insert: {
          user_id: string;
          batch_id: string;
          status?: 'active' | 'waitlist' | 'completed' | 'dropped';
          joined_at?: string;
        };
        Update: {
          user_id?: string;
          batch_id?: string;
          status?: 'active' | 'waitlist' | 'completed' | 'dropped';
          joined_at?: string;
        };
      };
      sessions: {
        Row: {
          id: string;
          batch_id: string;
          seq: number;
          title: string | null;
          starts_at: string;
          duration_min: number;
          status: 'scheduled' | 'live' | 'closed' | 'cancelled';
          started_at: string | null;
          closed_at: string | null;
          qr_seed: string | null;
          report: Json | null;
          created_at?: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          seq: number;
          title?: string | null;
          starts_at: string;
          duration_min?: number;
          status?: 'scheduled' | 'live' | 'closed' | 'cancelled';
          started_at?: string | null;
          closed_at?: string | null;
          qr_seed?: string | null;
          report?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          batch_id?: string;
          seq?: number;
          title?: string | null;
          starts_at?: string;
          duration_min?: number;
          status?: 'scheduled' | 'live' | 'closed' | 'cancelled';
          started_at?: string | null;
          closed_at?: string | null;
          qr_seed?: string | null;
          report?: Json | null;
          created_at?: string;
        };
      };
      attendance: {
        Row: {
          session_id: string;
          user_id: string;
          status: 'present' | 'late' | 'absent' | 'excused';
          checked_in_at: string | null;
          method: 'qr' | 'code' | 'manual' | null;
          note: string | null;
          created_at?: string;
        };
        Insert: {
          session_id: string;
          user_id: string;
          status?: 'present' | 'late' | 'absent' | 'excused';
          checked_in_at?: string | null;
          method?: 'qr' | 'code' | 'manual' | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          session_id?: string;
          user_id?: string;
          status?: 'present' | 'late' | 'absent' | 'excused';
          checked_in_at?: string | null;
          method?: 'qr' | 'code' | 'manual' | null;
          note?: string | null;
          created_at?: string;
        };
      };
      point_events: {
        Row: {
          id: string;
          user_id: string;
          points: number;
          reason_code: string;
          ref_type: string | null;
          ref_id: string | null;
          awarded_by: string | null;
          idempotency_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          points: number;
          reason_code: string;
          ref_type?: string | null;
          ref_id?: string | null;
          awarded_by?: string | null;
          idempotency_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          points?: number;
          reason_code?: string;
          ref_type?: string | null;
          ref_id?: string | null;
          awarded_by?: string | null;
          idempotency_key?: string;
          created_at?: string;
        };
      };
      streak_weeks: {
        Row: {
          user_id: string;
          week_start: string;
          status: 'active' | 'lost' | 'frozen' | 'excused';
          sessions_total: number;
          sessions_honored: number;
          freeze_used: boolean;
        };
        Insert: {
          user_id: string;
          week_start: string;
          status?: 'active' | 'lost' | 'frozen' | 'excused';
          sessions_total?: number;
          sessions_honored?: number;
          freeze_used?: boolean;
        };
        Update: {
          user_id?: string;
          week_start?: string;
          status?: 'active' | 'lost' | 'frozen' | 'excused';
          sessions_total?: number;
          sessions_honored?: number;
          freeze_used?: boolean;
        };
      };
      gamification: {
        Row: {
          user_id: string;
          current_streak_weeks: number;
          longest_streak_weeks: number;
          freezes_held: number;
          league_tier: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
          updated_at?: string;
        };
        Insert: {
          user_id: string;
          current_streak_weeks?: number;
          longest_streak_weeks?: number;
          freezes_held?: number;
          league_tier?: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          current_streak_weeks?: number;
          longest_streak_weeks?: number;
          freezes_held?: number;
          league_tier?: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
          updated_at?: string;
        };
      };
      badges: {
        Row: {
          code: string;
          name_ar: string;
          name_en: string;
          desc_ar: string | null;
          desc_en: string | null;
          rarity: 'common' | 'rare' | 'epic' | 'legendary';
          icon: string;
          active: boolean;
        };
        Insert: {
          code: string;
          name_ar: string;
          name_en: string;
          desc_ar?: string | null;
          desc_en?: string | null;
          rarity?: 'common' | 'rare' | 'epic' | 'legendary';
          icon: string;
          active?: boolean;
        };
        Update: {
          code?: string;
          name_ar?: string;
          name_en?: string;
          desc_ar?: string | null;
          desc_en?: string | null;
          rarity?: 'common' | 'rare' | 'epic' | 'legendary';
          icon?: string;
          active?: boolean;
        };
      };
      user_badges: {
        Row: {
          user_id: string;
          badge_code: string;
          awarded_at: string;
        };
        Insert: {
          user_id: string;
          badge_code: string;
          awarded_at?: string;
        };
        Update: {
          user_id?: string;
          badge_code?: string;
          awarded_at?: string;
        };
      };
      league_weeks: {
        Row: {
          user_id: string;
          week_start: string;
          tier: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
          xp_week: number;
          final_rank: number | null;
          outcome: 'promoted' | 'demoted' | 'maintained' | null;
        };
        Insert: {
          user_id: string;
          week_start: string;
          tier?: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
          xp_week?: number;
          final_rank?: number | null;
          outcome?: 'promoted' | 'demoted' | 'maintained' | null;
        };
        Update: {
          user_id?: string;
          week_start?: string;
          tier?: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
          xp_week?: number;
          final_rank?: number | null;
          outcome?: 'promoted' | 'demoted' | 'maintained' | null;
        };
      };
      certificates: {
        Row: {
          id: string;
          user_id: string;
          batch_id: string;
          serial: string;
          issued_at: string;
          status: 'active' | 'revoked';
          revoked_at: string | null;
          revoked_by: string | null;
          revoke_reason: string | null;
          reissued_at: string | null;
          reissued_by: string | null;
          reissue_count: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          batch_id: string;
          serial: string;
          issued_at?: string;
          status?: 'active' | 'revoked';
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoke_reason?: string | null;
          reissued_at?: string | null;
          reissued_by?: string | null;
          reissue_count?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          batch_id?: string;
          serial?: string;
          issued_at?: string;
          status?: 'active' | 'revoked';
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoke_reason?: string | null;
          reissued_at?: string | null;
          reissued_by?: string | null;
          reissue_count?: number;
        };
      };
      excuses: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          reason: string;
          attachment_url: string | null;
          status: 'pending' | 'accepted' | 'rejected';
          note: string | null;
          reviewed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          reason: string;
          attachment_url?: string | null;
          status?: 'pending' | 'accepted' | 'rejected';
          note?: string | null;
          reviewed_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          session_id?: string;
          reason?: string;
          attachment_url?: string | null;
          status?: 'pending' | 'accepted' | 'rejected';
          note?: string | null;
          reviewed_by?: string | null;
          created_at?: string;
        };
      };
      course_ratings: {
        Row: {
          id?: string;
          user_id: string;
          course_id: string;
          stars: number;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          course_id: string;
          stars: number;
          comment?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          course_id?: string;
          stars?: number;
          comment?: string | null;
          created_at?: string;
        };
      };
      instructor_ratings: {
        Row: {
          id?: string;
          user_id: string;
          instructor_id: string;
          batch_id: string;
          stars: number;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          instructor_id: string;
          batch_id: string;
          stars: number;
          comment?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          instructor_id?: string;
          batch_id?: string;
          stars?: number;
          comment?: string | null;
          created_at?: string;
        };
      };
      organization_ratings: {
        Row: {
          id?: string;
          user_id: string;
          branch_id: string;
          stars: number;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          branch_id: string;
          stars: number;
          comment?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          branch_id?: string;
          stars?: number;
          comment?: string | null;
          created_at?: string;
        };
      };
      gamification_rules: {
        Row: {
          key: string;
          value: Json;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          target: string | null;
          payload: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          target?: string | null;
          payload?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          action?: string;
          target?: string | null;
          payload?: Json | null;
          created_at?: string;
        };
      };
      kudos_quotas: {
        Row: {
          instructor_id: string;
          month: string;
          spent: number;
        };
        Insert: {
          instructor_id: string;
          month: string;
          spent?: number;
        };
        Update: {
          instructor_id?: string;
          month?: string;
          spent?: number;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          body: string | null;
          type: 'info' | 'streak_urgent' | 'streak_lost' | 'league_change' | 'badge_earned' | 'certificate' | 'excuse_status';
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          body?: string | null;
          type?: 'info' | 'streak_urgent' | 'streak_lost' | 'league_change' | 'badge_earned' | 'certificate' | 'excuse_status';
          read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          body?: string | null;
          type?: 'info' | 'streak_urgent' | 'streak_lost' | 'league_change' | 'badge_earned' | 'certificate' | 'excuse_status';
          read?: boolean;
          created_at?: string;
        };
      };
      private_notes: {
        Row: {
          instructor_id: string;
          user_id: string;
          note: string;
          updated_at: string;
        };
        Insert: {
          instructor_id: string;
          user_id: string;
          note: string;
          updated_at?: string;
        };
        Update: {
          instructor_id?: string;
          user_id?: string;
          note?: string;
          updated_at?: string;
        };
      };
      push_tokens: {
        Row: {
          user_id: string;
          token: string;
          platform: 'android' | 'ios' | 'web' | 'unknown';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          token: string;
          platform: 'android' | 'ios' | 'web' | 'unknown';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          token?: string;
          platform?: 'android' | 'ios' | 'web' | 'unknown';
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Functions: {
  // ─── BEGIN GENERATED RPC ARGS (scripts/gen-rpc-types.js) ───
  // مولَّد آليًا من supabase/migrations — لا تحرّره يدويًا.
  // أعِد التوليد: node scripts/gen-rpc-types.js --write
  /** 0023_course_lifecycle_truthfulness.sql */
  admin_update_user_access: { Args: { p_profile_id: string; p_role: string; p_status: string; p_branch_id?: string | null; p_clear_branch?: boolean | null }; Returns: Json };
  /** 0023_course_lifecycle_truthfulness.sql */
  archive_batch: { Args: { p_batch_id: string }; Returns: Json };
  /** 0024_course_operating_system.sql */
  assign_course_role: { Args: { p_course_id: string; p_user_id: string; p_role: string }; Returns: Json };
  /** 0025_rpc_rate_limits.sql */
  award_kudos: { Args: { p_student_id: string; p_batch_id: string; p_points: number; p_reason: string; p_idempotency_key: string }; Returns: Json };
  /** 0005_production_hardening.sql */
  bootstrap_organization: { Args: { p_payload: Json }; Returns: Json };
  /** 0005_production_hardening.sql */
  broadcast_notifications: { Args: { p_scope: string; p_scope_id: string; p_title: string; p_body: string }; Returns: Json };
  /** 0024_course_operating_system.sql */
  cancel_batch: { Args: { p_batch_id: string; p_reason?: string | null }; Returns: Json };
  /** 0024_course_operating_system.sql */
  cancel_training_session: { Args: { p_session_id: string; p_reason?: string | null }; Returns: Json };
  /** 0021_geofence_optional.sql */
  check_in_with_token: { Args: { p_payload: string; p_lat?: number | null; p_lng?: number | null }; Returns: Json };
  /** 0017_completion_rule_fix.sql */
  close_training_session: { Args: { p_session_id: string; p_report?: Json | null }; Returns: Json };
  /** 0005_production_hardening.sql */
  complete_my_profile: { Args: { p_full_name: string; p_phone: string; p_avatar_url?: string | null; p_branch_id?: string | null; p_gender?: string | null }; Returns: Json };
  /** 0023_course_lifecycle_truthfulness.sql */
  create_batch_with_sessions: { Args: { p_course_id: string; p_branch_id: string; p_instructor_id: string; p_code: string; p_capacity: number; p_room: string; p_schedule: Json; p_first_session_at: string; p_custom_sessions_count?: number | null }; Returns: Json };
  /** 0005_production_hardening.sql */
  create_branch: { Args: { p_name: string; p_governorate: string; p_address?: string | null }; Returns: Json };
  /** 0005_production_hardening.sql */
  create_committee: { Args: { p_branch_id: string; p_name: string }; Returns: Json };
  /** 0023_course_lifecycle_truthfulness.sql */
  create_course: { Args: { p_title: string; p_code: string; p_desc: string; p_sessions_count: number; p_committee_id?: string | null }; Returns: Json };
  /** 0008_account_deletion.sql */
  delete_my_account: { Args: { p_confirm: string }; Returns: Json };
  /** 0013_offline_command_queue.sql */
  enqueue_command: { Args: { p_command_id: string; p_command: string; p_payload?: Json | null; p_device_created_at?: string | null }; Returns: Json };
  /** 0013_offline_command_queue.sql */
  finish_command: { Args: { p_command_id: string; p_status?: string | null }; Returns: Json };
  /** 0011_analytics_views.sql */
  get_analytics: { Args: { p_scope: string; p_scope_id?: string | null }; Returns: Json };
  /** 0012_domain_query_layer.sql */
  get_batch_roster: { Args: { p_batch_id: string }; Returns: Json };
  /** 0012_domain_query_layer.sql */
  get_batch_sessions: { Args: { p_batch_id: string }; Returns: Json };
  /** 0005_production_hardening.sql */
  get_batch_stats: { Args: { p_offset?: number | null; p_limit?: number | null }; Returns: Json };
  /** 0013_offline_command_queue.sql */
  get_command: { Args: { p_command_id: string }; Returns: Json };
  /** 0012_domain_query_layer.sql */
  get_course_overview: { Args: { p_course_id: string }; Returns: Json };
  /** 0024_course_operating_system.sql */
  get_detailed_course_analytics: { Args: { p_course_id: string }; Returns: Json };
  /** 0005_production_hardening.sql */
  get_session_qr_payload: { Args: { p_session_id: string }; Returns: Json };
  /** 0010_session_report.sql */
  get_session_report: { Args: { p_session_id: string }; Returns: Json };
  /** 0012_domain_query_layer.sql */
  get_session_roster: { Args: { p_session_id: string }; Returns: Json };
  /** 0005_production_hardening.sql */
  is_admin: { Args: Record<string, never>; Returns: Json };
  /** 0023_course_lifecycle_truthfulness.sql */
  is_staff: { Args: Record<string, never>; Returns: Json };
  /** 0017_completion_rule_fix.sql */
  issue_batch_certificates: { Args: { p_batch_id: string }; Returns: Json };
  /** 0023_course_lifecycle_truthfulness.sql */
  join_batch: { Args: { p_batch_id: string }; Returns: Json };
  /** 0025_rpc_rate_limits.sql */
  join_batch_by_code: { Args: { p_join_code: string }; Returns: Json };
  /** 0009_waitlist_promotion.sql */
  leave_batch: { Args: { p_batch_id: string }; Returns: Json };
  /** 0005_production_hardening.sql */
  list_visible_profiles: { Args: { p_offset?: number | null; p_limit?: number | null }; Returns: Json };
  /** 0027_client_error_log.sql */
  log_client_error: { Args: { p_message: string; p_stack?: string | null; p_component_stack?: string | null; p_fatal?: boolean | null; p_platform?: string | null; p_app_version?: string | null; p_breadcrumbs?: Json | null }; Returns: Json };
  /** 0005_production_hardening.sql */
  manual_mark_attendance: { Args: { p_session_id: string; p_user_id: string; p_status: string; p_reason: string }; Returns: Json };
  /** 0014_critical_fixes.sql */
  mark_notifications_read: { Args: Record<string, never>; Returns: Json };
  /** 0023_course_lifecycle_truthfulness.sql */
  notify_session_absentees: { Args: { p_session_id: string }; Returns: Json };
  /** 0009_waitlist_promotion.sql */
  promote_batch_waitlist: { Args: { p_batch_id: string }; Returns: Json };
  /** 0009_waitlist_promotion.sql */
  promote_waitlists: { Args: Record<string, never>; Returns: Json };
  /** 0025_rpc_rate_limits.sql */
  register_push_token: { Args: { p_token: string; p_platform?: string | null }; Returns: Json };
  /** 0020_certificate_revocation.sql */
  reissue_certificate: { Args: { p_certificate_id: string }; Returns: Json };
  /** 0009_waitlist_promotion.sql */
  remove_from_batch: { Args: { p_batch_id: string; p_user_id: string }; Returns: Json };
  /** 0024_course_operating_system.sql */
  reschedule_training_session: { Args: { p_session_id: string; p_starts_at: string; p_reason?: string | null }; Returns: Json };
  /** 0005_production_hardening.sql */
  review_excuse: { Args: { p_excuse_id: string; p_decision: string; p_note?: string | null }; Returns: Json };
  /** 0005_production_hardening.sql */
  review_support_request: { Args: { p_request_id: string; p_status: string; p_response: string }; Returns: Json };
  /** 0020_certificate_revocation.sql */
  revoke_certificate: { Args: { p_certificate_id: string; p_reason: string }; Returns: Json };
  /** 0024_course_operating_system.sql */
  revoke_course_role: { Args: { p_course_id: string; p_user_id: string; p_role: string }; Returns: Json };
  /** 0002_gamification_rpcs.sql */
  rule_num: { Args: { p_key: string }; Returns: Json };
  /** 0015_command_executor.sql */
  run_command: { Args: { p_command_id: string; p_command: string; p_payload?: Json | null; p_device_created_at?: string | null }; Returns: Json };
  /** 0019_save_private_note.sql */
  save_private_note: { Args: { p_user_id: string; p_note: string }; Returns: Json };
  /** 0005_production_hardening.sql */
  set_badge_active: { Args: { p_code: string; p_active: boolean }; Returns: Json };
  /** 0023_course_lifecycle_truthfulness.sql */
  set_course_status: { Args: { p_course_id: string; p_status: string }; Returns: Json };
  /** 0026_push_delivery_outbox.sql */
  set_push_preferences: { Args: { p_prefs: Json }; Returns: Json };
  /** 0005_production_hardening.sql */
  start_training_session: { Args: { p_batch_id: string }; Returns: Json };
  /** 0017_completion_rule_fix.sql */
  submit_course_rating: { Args: { p_course_id: string; p_stars: number; p_comment?: string | null }; Returns: Json };
  /** 0025_rpc_rate_limits.sql */
  submit_excuse: { Args: { p_session_id: string; p_reason: string; p_attachment_url?: string | null }; Returns: Json };
  /** 0005_production_hardening.sql */
  submit_support_request: { Args: { p_kind: string; p_subject: string; p_body: string; p_recipient_id?: string | null }; Returns: Json };
  /** 0022_push_tokens.sql */
  unregister_push_token: { Args: { p_token: string }; Returns: Json };
  /** 0023_course_lifecycle_truthfulness.sql */
  update_course_details: { Args: { p_course_id: string; p_title: string; p_code: string; p_desc: string; p_sessions_count: number; p_committee_id?: string | null }; Returns: Json };
  /** 0005_production_hardening.sql */
  update_gamification_rule: { Args: { p_key: string; p_value: number }; Returns: Json };
  /** 0005_production_hardening.sql */
  update_my_profile: { Args: { p_full_name: string; p_phone: string; p_avatar_url?: string | null }; Returns: Json };
  /** 0001_schema.sql */
  update_updated_at_column: { Args: Record<string, never>; Returns: Json };
  /** 0020_certificate_revocation.sql */
  verify_certificate: { Args: { p_serial: string }; Returns: Json };
  // ─── END GENERATED RPC ARGS ───
    };
  };
}
