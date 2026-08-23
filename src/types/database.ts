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
        };
        Insert: {
          id?: string;
          user_id: string;
          batch_id: string;
          serial: string;
          issued_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          batch_id?: string;
          serial?: string;
          issued_at?: string;
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
    };
    Functions: {
      get_user_gamification: {
        Args: { p_user_id: string };
        Returns: {
          points: number;
          streak: number;
          level: number;
          tier: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
        };
      };
      check_in_session: {
        Args: {
          p_session_id: string;
          p_user_id: string;
          p_method: string;
        };
        Returns: {
          success: boolean;
          points?: number;
          status?: string;
          error?: string;
        };
      };
    };
  };
}
